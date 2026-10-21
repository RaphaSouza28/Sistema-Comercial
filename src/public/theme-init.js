// Aplica o tema salvo antes da renderização, evitando "piscar" ao abrir o aplicativo.
;(function () {
  try {
    var pref = localStorage.getItem('sc.theme') || 'system'
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
  } catch (e) {
    /* armazenamento indisponível: usa o tema claro */
  }
})()
