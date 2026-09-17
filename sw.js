const CACHE_NAME='taxicuenta-pwa-v1.0.14-core';
const CORE=['./','./index.html','./instrucciones.html','./styles.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-contabilidad-taxi.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(CORE))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  // No se enumeran ni se borran cachés anteriores o ajenas.
  // La versión actual simplemente trabaja exclusivamente con su propia caché.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);

  if(url.origin===self.location.origin){
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache=>{
        const cached=await cache.match(event.request);
        if(cached) return cached;
        try{
          const response=await fetch(event.request);
          if(response && response.ok){
            try{await cache.put(event.request,response.clone());}catch(_e){}
          }
          return response;
        }catch(_e){
          return cache.match('./index.html');
        }
      })
    );
    return;
  }

  // Recursos externos (XLSX/PDF): también se guardan únicamente
  // dentro de la caché propia de esta PWA.
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache=>{
      const cached=await cache.match(event.request);
      if(cached) return cached;
      const response=await fetch(event.request);
      try{await cache.put(event.request,response.clone());}catch(_e){}
      return response;
    })
  );
});
