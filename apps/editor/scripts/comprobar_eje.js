/* ===========================================================================
   ¿El peso variable que la plantilla anima se VE?
   ---------------------------------------------------------------------------
   `font-variation-settings` solo hace algo si la cara que el emparejado de CSS
   ha elegido es el fichero VARIABLE. Esta máquina tiene la familia estática
   completa instalada junto a la variable, así que declarar `font-weight: 500`
   elige `Geist-Medium.otf` — y una estática no tiene ejes: la animación del eje
   no mueve un píxel.

   Ocho plantillas del catálogo escribían el eje en cada fotograma sin mover
   nada. No lo ve el humo —la plantilla se mueve por otras razones—, no lo ve el
   lint —la propiedad se escribe— ni el auditor de estilo —el fichero dice lo
   correcto—, y `document.fonts.check` miente por diseño: devuelve `true` para
   familias que no existen. La única forma de verlo es comparar PÍXELES.

   Y no se arregla desde CSS: el fichero variable y el estático comparten nombre
   PostScript —los dos son `Geist-Regular`—, así que un `@font-face` con
   `local()` elige uno u otro según el orden del sistema. La salida portable es
   `Engine.peso`, que escribe las dos propiedades.

   Esto comprueba que sigue siendo verdad. Para cada plantilla que anima el eje,
   recoge los pares (familia, peso) de los elementos que lo RECIBEN de verdad
   —recorriendo la capa en veinte instantes, porque hay gestos que solo escriben
   en una fase— y rasteriza una sonda con ese par a peso 200 y a 900. Si el PNG
   sale idéntico, ese gesto no existe.

   Uso:  node scripts/comprobar_eje.js
   =========================================================================== */

const {chromium}=require('playwright');
const {MUESTRAS}=require('./hoja_contactos.js');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const TPL=path.join(path.dirname(__dirname),'templates');
const porM=new Map(); MUESTRAS.forEach(m=>{if(!porM.has(m.f))porM.set(m.f,m);});
(async()=>{
  const nav=await chromium.launch();
  const pg=await nav.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  const malas=[];
  for(const f of fs.readdirSync(TPL).filter(x=>x.endsWith('.html')&&!x.startsWith('_')).sort()){
    const src=fs.readFileSync(path.join(TPL,f),'utf8');
    if(!/fontVariationSettings/.test(src)) continue;
    const m=porM.get(f);
    await pg.goto('file://'+path.join(TPL,f),{waitUntil:'load'});
    await pg.evaluate(()=>document.fonts.ready);
    await pg.evaluate(c=>window.TPL.setup(c),Object.assign({tema:'carbon'},m?m.cfg:{}));
    await pg.evaluate(()=>document.fonts.ready);
    // Solo los elementos que RECIBEN `fontVariationSettings` de verdad. Se
    // recorre la capa en veinte instantes porque hay plantillas que solo lo
    // escriben en una fase (el peso que sube al activarse, por ejemplo).
    const dur=await pg.evaluate(()=>window.TPL.duration||5);
    const vistos=new Set();
    for(let k=0;k<=20;k++){
      await pg.evaluate(t=>window.TPL.seek(t), +(dur*k/20).toFixed(3));
      (await pg.evaluate(()=>{
        const s=new Set();
        document.querySelectorAll('.stage *').forEach(e=>{
          if(!e.style.fontVariationSettings) return;
          const c=getComputedStyle(e);
          s.add(c.fontFamily.split(',')[0].replace(/['"]/g,'')+'|'+c.fontWeight);
        });
        return [...s];
      })).forEach(x=>vistos.add(x));
    }
    const pares=[...vistos];
    for(const par of pares){
      const [fam,peso]=par.split('|');
      const hs=[];
      for(const ax of [200,900]){
        await pg.evaluate(([fa,pe,a])=>{
          let d=document.getElementById('__probe');
          if(!d){d=document.createElement('div');d.id='__probe';
            d.style.cssText='position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000;font-size:64px';
            document.body.appendChild(d);}
          d.style.fontFamily=fa;
          // El MISMO mecanismo que usa `Engine.peso`: las dos propiedades.
          // Variar solo el eje era la sonda vieja, y desde que el catálogo
          // escribe las dos, medir solo una es medir otra cosa.
          d.style.fontWeight=String(a);
          d.style.fontVariationSettings='"wght" '+a; d.textContent='0123 Hola';
        },[fam,peso,ax]);
        hs.push(crypto.createHash('md5').update(
          await pg.screenshot({clip:{x:0,y:0,width:600,height:90}})).digest('hex'));
      }
      await pg.evaluate(()=>{const d=document.getElementById('__probe'); if(d) d.remove();});
      if(hs[0]===hs[1]) malas.push(f+'  '+fam+' @ font-weight:'+peso);
    }
  }
  await nav.close();
  if(malas.length){
    console.error('\n  EJE MUERTO — estos gestos de peso no mueven un píxel:\n');
    malas.forEach(m=>console.error('    '+m));
    console.error('\n  Usa `Engine.peso(el, n)`, que escribe también `font-weight`.\n');
    process.exitCode=1;
  } else {
    console.log('\n  ✓ el eje variable vive en los '+
                'pares (familia, peso) que el catálogo anima\n');
  }
})();
