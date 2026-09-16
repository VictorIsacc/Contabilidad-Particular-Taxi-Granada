const CACHE_NAME='taxicuenta-pwa-v1.0.1-core';
const CORE=['./','./index.html','./instrucciones.html','./styles.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./logo-contabilidad-taxi.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  // Deliberadamente no se enumeran ni borran otras cachés del origen.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin===self.location.origin){
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
      if(response && response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(c=>c.put(event.request,copy));}
      return response;
    }).catch(()=>caches.match('./index.html'))));
    return;
  }
  // Recursos externos (XLSX/PDF): cache de ejecución solo dentro de la caché propia de esta app.
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    const cached=await cache.match(event.request);
    if(cached) return cached;
    const response=await fetch(event.request);
    try{await cache.put(event.request,response.clone());}catch(_e){}
    return response;
  }));
});
