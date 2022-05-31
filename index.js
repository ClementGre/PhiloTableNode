import {html_before, html_after} from './index.html.js'
import { Client } from "@notionhq/client"
import _ from 'lodash';
import fs from 'fs'
import express from 'express'


const secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf-8').toString())

const TOKEN = secrets.token
const IDEAS_DB_ID = '2e1e0dfa4dbb46dd8d6f9fa4f69c4a0c'
const AUTHORS_DB_ID = '5950c6f8f9054e058a0fc403cf8ab511'
const QUOTES_DB_ID = '435e9cede083452a98247441c2b56517'
const NOTIONS_DB_ID = '718b55588bdb4430a4739240c6a121c8';
const USE_CACHE = true;

const notion = new Client({auth: TOKEN})
const app = express()

let cache = {}
fs.readFile('cache.json', 'utf-8', (err, data) => {
    if(err) throw err;
    if(data) cache = JSON.parse(data.toString());
});



app.use(express.static('public'))

app.get('/', function (req, res) {
    getHTML().then((html) => {
        res.send(html);
    })
})
app.get('/reloadother', function (req, res) {
    console.log("Reload other (clearing authors, quotes & notions)")
    delete cache.authors
    delete cache.quotes
    delete cache.notions
    saveCache()
    res.redirect(307, '../');
})
app.get('/reload/:notion', function (req, res) {
    console.log("Reloading notion", req.params.notion)
    reloadNotion(req.params.notion).then(r => {
        res.redirect(307, '../../#' + req.params.notion.replace(/\s/g, '').toLowerCase());
    })
})

app.listen(8080)

async function reloadNotion(notionName){
    // Clear ideas of this notion in cache
    if(!cache.ideas) cache.ideas = []
    
    cache.ideas.forEach((properties, index) => {
        if(properties){
            const idea = new Idea(properties);
            if(idea.notions.includes(formatText(notionName))){
                delete cache.ideas[index]
            }
        }
    })
    
    // Load ideas list from db
    const ideas_res = await notion.databases.query({
        database_id: IDEAS_DB_ID,
        sorts: [{property: 'Order', direction: 'ascending'}],
        filter: {
            "property": "Notion",
            "multi_select": {
                "contains": notionName
            }
        }
    });
    
    for(const page_id of _.map(ideas_res.results, 'id')){
        const page_props = (await notion.pages.retrieve({page_id: page_id+''})).properties;
        cache.ideas.push(page_props)
    }
    saveCache()
}

async function getHTML(){
    await mapAuthors()
    await mapQuotes()
    await mapNotions()

    let ideas = [];
    if(!cache.ideas) cache.ideas = []
    
    for(const properties of cache.ideas){
        if(properties) ideas.push(new Idea(properties))
    }
    
    
    return html_before + getHTMLFromNotions(getNotionsFromIdeas(ideas)) + html_after
}
function saveCache(){
    fs.writeFileSync('cache.json', JSON.stringify(cache, null, 4), (err) => {if(err) throw err;});
}
async function mapAuthors(){
    if(!USE_CACHE || !cache.authors){
        console.log("Map authors")
        cache.authors = {};
        for(const [id, props] of await getPagesPropsInDB(AUTHORS_DB_ID))
            cache.authors[id] = _.map(props['Nom'].title, 'plain_text').join('')

        saveCache()
    }
}
async function mapQuotes(){
    if(!USE_CACHE || !cache.quotes){
        console.log("Map quotes")
        cache.quotes = {};
        for(const [id, props] of await getPagesPropsInDB(QUOTES_DB_ID))
            cache.quotes[id] = _.map(props['Citation'].title, 'plain_text').join('')

        saveCache()
    }
}
async function mapNotions(){
    if(!USE_CACHE || !cache.notions){
        console.log("Map notions")
        cache.notions = {};
        for(const [id, props] of await getPagesPropsInDB(NOTIONS_DB_ID, [{property: 'Order', direction: 'ascending'}])){
            let notion_name = formatText((_.map(props['Nom'].title, 'plain_text').join('')))
            cache.notions[notion_name] = props
        }
        saveCache()
    }
}

// Return an iterable Object.entries() object
async function getPagesPropsInDB(db_name, sorts = []){
    const response = await notion.databases.query({ database_id: db_name, sorts: sorts });
    let pages = {}
    for(const page_id of _.map(response.results, 'id')){
        pages[page_id] = (await notion.pages.retrieve({page_id: page_id+''})).properties;
    }
    return Object.entries(pages)
}


function getNotionsFromIdeas(ideas){
    let notionsData = {}
    
    Object.keys(cache.notions).forEach(name => {
        notionsData[name] = [];
    })
    ideas.forEach(idea => {
        idea.notions.forEach(notion => {
            notion = formatText(notion)
            if(notionsData[notion]) notionsData[notion].push(idea)
            else notionsData[notion] = [idea]
        })
    })
    
    

    let notions = []
    for(const [notion, ideas] of Object.entries(notionsData)){
        for(const [fullName, props] of Object.entries(cache.notions)){
            if(fullName === notion){
                notions.push(new Notion(fullName, props, ideas))
                break
            }
        }
    }
    return notions
}

function getHTMLFromNotions(notions){
    let html = ''
    notions.forEach(notion => {
        html += notion.getHTML()
    })
    return html
}

class Idea {
    notions
    work
    workColor = "black"
    author
    theory
    description
    quotes
    constructor(properties) {
        // Multi select
        this.notions = _.map(properties['Notion'].multi_select, 'name')
        // Title
        this.theory = formatText((_.map(properties['Thèse'].title, 'plain_text').join('')))
        // Plain text
        this.work = formatText(_.map(properties['Ouvrage'].rich_text, data => {
            if(data.annotations.color !== 'default') this.workColor = data.annotations.color
            return data.text.content;
        }).join('\n'))

        // Relation
        this.author = _.map(properties['Philosophe'].relation, relation => cache.authors[relation.id]).join(', ')
        this.quotes = formatText(_.map(properties['Citation'].relation, relation => '«&nbsp;' + cache.quotes[relation.id] + '&nbsp;»').join('<br/>'))

        if(!this.author && !this.work && !this.theory){
            this.description = formatText(_.map(properties['Détails'].rich_text, data => data.plain_text).join('')
                .split('\n').join('<br/><i class="fa-solid fa-arrow-turn-up"></i>'))
        }else{
            this.description = extractRichText(properties['Détails'])
        }

        if(this.work === 'Ouvrage Inconnu') this.work = undefined;
    }
    getHTML(){
        if(!this.theory && !this.description) return '';

        if(!this.author && !this.work && !this.theory){
            return `<div class="question">
                        <h2><i class="fa-solid fa-arrow-turn-up"></i>` + this.description + `</h2>
                    </div>`
        }

        return `<div class="idea">
                    <div class="top">
                        <h2 class="author">
                            ` + this.getAuthorOrEmpty() + `
                        </h2>
                        <h3 class="work" style="color:` + this.workColor + `;">
                            ` + (this.work ? '<i class="fa-solid fa-book"></i>' + this.work : '') + `
                        </h3>
                    </div>
                    <div class="bottom">
                        <p class="theory">` + this.getTheoryOrEmpty() + `</p>
                        <p class="description">` + this.getDescriptionOrEmpty() + `</p>
                    </div>
                    <div class="quotes">
                        ` + (this.quotes ? (`<p>` + this.quotes + `</p>`) : '') + `
                    </div>
                </div>
            `
    }
    getAuthorOrEmpty(){
        return this.author ? this.author : ''
    }
    getWorkOrEmpty(){
        return this.work ? this.work : ''
    }
    getTheoryOrEmpty(){
        return this.theory ? this.theory : ''
    }
    getDescriptionOrEmpty(){
        return this.description ? this.description : ''
    }

}

class Notion {
    name
    ideas
    etymology
    definition
    constructor(name, props, ideas){
        this.name = name
        this.etymology = extractRichText(props['Etymologie'])
        this.definition = extractRichText(props['Définition'])
        this.ideas = ideas
    }
    getHTML(){
        let ideasHTML = ''
        this.ideas.forEach(idea => {
            ideasHTML += idea.getHTML();
        })

        return `<div class="notion" id="` + this.name.replace(/\s/g, '').toLowerCase() + `">
                    <hr>
                    <div class="reload" notion="` + this.name + `" onclick="document.getElementById('js-page-loader').classList.add('active'); location.href = 'reload/' + this.getAttribute('notion') + '/';">
                        <i class="fa-solid fa-rotate"></i>
                        <p>Actualiser</p>
                    </div>
                    <h1>` + this.name + `</h1>
                    <hr>
                    
                    <div class="notionInfo">
                        <p class="etymology">
                           ` + (this.etymology ? '<i class="fa-solid fa-lightbulb"></i>' + this.etymology : '') + `
                        </p>
                        <p class="definition">
                           ` + (this.definition ? '<i class="fa-solid fa-book-bookmark"></i>' + this.definition : '') + `
                        </p>
                    </div>
                    
                    <div class="ideas">
                        ` + ideasHTML + `
                    </div>
                </div>
            `
    }
    getDefinitionOrEmpty(){
        return this.definition ? this.definition : '';
    }
}

function formatText(text){
    if(text){
        text = text.split('\n').join('<br/>')
            .split(' ?').join('&nbsp;?')
            .split(' !').join('&nbsp;!')
            .split(' :').join('&nbsp;:')
            .split('“').join('«&nbsp;')
            .split('”').join('&nbsp;»')
            .split("'").join("’")
    }
    return text;
}
function extractRichText(property_data){
    return formatText(_.map(property_data.rich_text, data => {
        if(!data.text) return data.plain_text
        let text = data.text.content;
        if(data.annotations.bold) text = '<b>' + text + '</b>'
        if(data.annotations.underline) text = '<span style="text-decoration: underline;">' + text + '</span>'
        if(data.annotations.italic) text = '<i>' + text + '</i>'
        if(data.annotations.strikethrough) text = '<del>' + text + '</del>'
        if(data.annotations.color !== 'default') text = '<span style="color:' + data.annotations.color + '; filter: brightness(70%);">' + text + '</span>'
        return text;
    }).join(''))
}