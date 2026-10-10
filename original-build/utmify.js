(function () {
  if (window.piskouUtmifyLoaded) return
  window.piskouUtmifyLoaded = true
  window.pixelId = '6ac69d9f82f406a3a324fcbe'

  const pixel = document.createElement('script')
  pixel.src = 'https://cdn.utmify.com.br/scripts/pixel/pixel.js'
  pixel.async = true
  pixel.defer = true
  document.head.appendChild(pixel)

  const utms = document.createElement('script')
  utms.src = 'https://cdn.utmify.com.br/scripts/utms/latest.js'
  utms.async = true
  utms.defer = true
  utms.setAttribute('data-utmify-prevent-xcod-sck', '')
  utms.setAttribute('data-utmify-prevent-subids', '')
  document.head.appendChild(utms)
})()
