/* PsiConsultório — seletor compartilhado de tema (direção visual) e modo (claro/escuro)
   para index.html, concept.html e icons.html. A escolha fica salva no navegador, então as
   páginas ficam sincronizadas. Modo padrão = preferência do sistema. Falhas de armazenamento
   (modo privado, file://) são ignoradas.
   <html data-theme="lavanda|indigo|salvia" data-mode="light|dark"> */
(function(){
  var KT='psi-ds-theme', KM='psi-ds-mode', root=document.documentElement;
  var THEMES=[['lavanda','Lavanda serena'],['indigo','Índigo noturno'],['salvia','Sálvia terrosa']];
  var t=null, m=null;
  try{ t=localStorage.getItem(KT); m=localStorage.getItem(KM); }catch(e){}
  if(!t || !THEMES.some(function(x){return x[0]===t;})) t='lavanda';          /* primeira direção = padrão */
  if(m!=='light' && m!=='dark') m=(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
  function apply(){ root.setAttribute('data-theme',t); root.setAttribute('data-mode',m); }
  apply();
  function save(){ try{ localStorage.setItem(KT,t); localStorage.setItem(KM,m); }catch(e){} }
  window.PSI_THEMES=THEMES;
  document.addEventListener('DOMContentLoaded',function(){
    var ts=document.getElementById('themeSel'), ms=document.getElementById('modeSel');
    if(ts){
      ts.innerHTML=THEMES.map(function(x){return '<option value="'+x[0]+'">'+x[1]+'</option>';}).join('');
      ts.value=t;
      ts.addEventListener('change',function(){ t=ts.value; apply(); save(); document.dispatchEvent(new CustomEvent('psi-theme')); });
    }
    if(ms){
      ms.innerHTML='<option value="light">Claro</option><option value="dark">Escuro</option>';
      ms.value=m;
      ms.addEventListener('change',function(){ m=ms.value; apply(); save(); document.dispatchEvent(new CustomEvent('psi-theme')); });
    }
  });
})();
