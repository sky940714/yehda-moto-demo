'use client';
import {useEffect} from 'react';

type Language='zh'|'en';
type TranslationCache=Record<string,string>;
const CACHE_KEY='yehda-auto-translation-cache-v1';
const CHINESE=/[\u3400-\u9fff]/;
const SKIP_TAGS=new Set(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','TEXTAREA']);
const ATTRIBUTES=['placeholder','title','aria-label'] as const;
const textOriginals=new WeakMap<Text,string>();
const attributeOriginals=new WeakMap<Element,Map<string,string>>();

function readCache():TranslationCache{try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')}catch{return {}}}
function writeCache(cache:TranslationCache){try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache))}catch{}}
function eligibleText(value:string){const text=value.trim();return text.length>0&&CHINESE.test(text)}
function collect(root:Node){
  const entries:Array<{original:string;apply:(value:string)=>void}>=[];
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let current:Node|null=root.nodeType===Node.TEXT_NODE?root:walker.nextNode();
  while(current){
    const node=current as Text,parent=node.parentElement;
    if(parent&&!SKIP_TAGS.has(parent.tagName)&&!parent.closest('.languageSwitch')){
      const currentValue=node.nodeValue??'';
      const savedOriginal=textOriginals.get(node);
      const original=savedOriginal??currentValue;
      if(savedOriginal===undefined&&eligibleText(currentValue))textOriginals.set(node,currentValue);
      if(eligibleText(original))entries.push({original,apply:value=>{if(node.isConnected)node.nodeValue=value}});
    }
    current=walker.nextNode();
  }
  const elements=root.nodeType===Node.ELEMENT_NODE?[(root as Element),...(root as Element).querySelectorAll('*')]:[];
  for(const element of elements){
    if(SKIP_TAGS.has(element.tagName)||element.closest('.languageSwitch'))continue;
    let originals=attributeOriginals.get(element);
    if(!originals){originals=new Map();attributeOriginals.set(element,originals)}
    for(const attribute of ATTRIBUTES){
      const currentValue=element.getAttribute(attribute);if(currentValue===null)continue;
      if(!originals.has(attribute)&&eligibleText(currentValue))originals.set(attribute,currentValue);
      const original=originals.get(attribute)??currentValue;
      if(eligibleText(original))entries.push({original,apply:value=>{if(element.isConnected)element.setAttribute(attribute,value)}});
    }
  }
  return entries;
}
function restore(root:Node){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let current:Node|null=root.nodeType===Node.TEXT_NODE?root:walker.nextNode();
  while(current){const node=current as Text,original=textOriginals.get(node);if(original!==undefined)node.nodeValue=original;current=walker.nextNode()}
  const elements=root.nodeType===Node.ELEMENT_NODE?[(root as Element),...(root as Element).querySelectorAll('*')]:[];
  for(const element of elements){attributeOriginals.get(element)?.forEach((value,key)=>element.setAttribute(key,value))}
}

export function useAutoTranslate(lang:Language){
  useEffect(()=>{
    let cancelled=false,timer:number|undefined,running=false,rerun=false;const pending=new Set<Node>();
    const translate=async(root:Node)=>{
      const entries=collect(root),cache=readCache();
      const missing=[...new Set(entries.map(entry=>entry.original).filter(text=>!cache[text]))];
      for(let index=0;index<missing.length;index+=128){
        const batch=missing.slice(index,index+128);
        try{
          const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texts:batch})});
          if(!response.ok)break;
          const result=await response.json() as {translations?:TranslationCache};Object.assign(cache,result.translations||{});writeCache(cache);
        }catch{break}
      }
      if(!cancelled)entries.forEach(entry=>entry.apply(cache[entry.original]||entry.original));
    };
    const flush=async()=>{
      timer=undefined;
      if(running){rerun=true;return}
      running=true;pending.clear();
      await translate(document.body);
      running=false;
      if(rerun&&!cancelled){rerun=false;timer=window.setTimeout(()=>void flush(),250)}
    };
    if(lang==='en')void flush();else restore(document.body);
    const observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        if(mutation.type==='characterData')pending.add(mutation.target);
        mutation.addedNodes.forEach(node=>pending.add(node));
        if(mutation.type==='attributes')pending.add(mutation.target);
      }
      if(lang==='en'&&pending.size&&!timer)timer=window.setTimeout(flush,120);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:[...ATTRIBUTES]});
    return()=>{cancelled=true;observer.disconnect();if(timer)window.clearTimeout(timer)};
  },[lang]);
}

export default function AutoTranslate({lang,children}:{lang:Language;children:React.ReactNode}){
  useAutoTranslate(lang);
  return children;
}
