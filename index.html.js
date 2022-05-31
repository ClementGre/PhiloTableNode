const html_before = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
        <title>PhiloTable</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>

        <link rel="stylesheet" href="./main.css">
        <script src="https://kit.fontawesome.com/7b36e9f84c.js" crossorigin="anonymous"></script>

</head>
<body>

<div class="loader" id="js-page-loader">
    <div class="loader-div"><div class="loader-bar"></div></div>
</div>

<main>`

const html_after = `

<div class="reload" onclick="document.getElementById('js-page-loader').classList.add('active'); location.href = 'reloadother/'">
    <i class="fa-solid fa-rotate"></i>
    <p>Actualiser les notions, auteurs et citations</p>
</div>
</main>



</body>
</html>`

export {html_before, html_after}