function toggleTheme() {

    var theme = localStorage.getItem("theme")
    document.getElementById("dark-theme-span").style.visibility="none";
    document.getElementById("light-theme-span").style.visibility="block";
    // change data-theme
    if (!theme || theme === "light") {
        setTheme("dark")
    }
    else {
        setTheme("light")
    }
}

function reRenderMermaidDiagrams(theme) {
    if (window.mermaid) {
        window.mermaid.initialize({ theme: theme });
        document.querySelectorAll('.mermaid').forEach((el) => {
            const graphDefinition = el.getAttribute('data-graph-definition') || el.textContent || el.innerText;
            el.innerHTML = ''; // Clear existing diagram
            el.removeAttribute('data-processed'); // Clear processed attribute
            el.setAttribute('data-graph-definition', graphDefinition); // Store graph definition
            el.textContent = graphDefinition; // Restore graph definition
            mermaid.init(undefined, el); // Force re-render
        });
    }
}

function setTheme(theme) {

    var prettifyDark = document.getElementById('prettify-dark')
    var sheets = document.styleSheets

    // temporariily set transition class on html element
    document.documentElement.classList.add('transition-theme')

    if (theme === "dark") {
        document.getElementById("dark-theme-span").style.visibility="hidden";
        document.getElementById("light-theme-span").style.visibility="visible";
        document.documentElement.setAttribute("data-theme", "dark")
        prettifyDark.removeAttribute('disabled')
        prettifyDark.disabled = false
        localStorage.setItem("theme", "dark")

        // Re-render Mermaid diagrams with dark theme
        reRenderMermaidDiagrams('dark');
    }
    else {
        document.getElementById("light-theme-span").style.visibility="hidden";
        document.getElementById("dark-theme-span").style.visibility="visible";
        document.documentElement.removeAttribute("data-theme", "dark")
        prettifyDark.disabled = true
        localStorage.setItem("theme", "light")

        // Re-render Mermaid diagrams with default (light) theme
        reRenderMermaidDiagrams('default');
    }

    // remove transition class
    window.setTimeout(function () {
        document.documentElement.classList.remove('transition-theme')
    }, 1000)
}

document.addEventListener("DOMContentLoaded", function() {
    var theme = localStorage.getItem("theme") || "dark"
    setTheme(theme);
  });