(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function inline(value){return String(value).split(/(`[^`\n]+`)/).map(part=>part.startsWith('`')&&part.endsWith('`')?'<code>'+escape(part.slice(1,-1))+'</code>':escape(part).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')).join('');}
 function render(value){
  return String(value??'').split(/\n\s*\n/).map(block=>{const lines=block.split('\n');if(lines.every(line=>/^\s*[-*] +/.test(line)))return '<ul>'+lines.map(line=>'<li>'+inline(line.replace(/^\s*[-*] +/,''))+'</li>').join('')+'</ul>';if(lines.every(line=>/^\s*\d+\. +/.test(line)))return '<ol>'+lines.map(line=>'<li>'+inline(line.replace(/^\s*\d+\. +/,''))+'</li>').join('')+'</ol>';return '<p>'+lines.map(inline).join('<br>')+'</p>';}).join('');
 }
 const api={render,escape};if(typeof module==='object'&&module.exports)module.exports=api;else root.CompanionReply=api;
})(globalThis);
