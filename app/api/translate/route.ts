import {NextResponse} from 'next/server';

const MAX_ITEMS=128;
const MAX_CHARACTERS=12000;
const MAX_CACHE_ENTRIES=5000;
const translationCache=new Map<string,string>();

function remember(source:string,translated:string){
  if(translationCache.has(source))translationCache.delete(source);
  translationCache.set(source,translated);
  if(translationCache.size>MAX_CACHE_ENTRIES){
    const oldest=translationCache.keys().next().value;
    if(oldest!==undefined)translationCache.delete(oldest);
  }
}

export async function POST(request:Request){
  const apiKey=process.env.DEEPL_API_KEY;
  if(!apiKey)return NextResponse.json({error:'Translation service is not configured.'},{status:503});
  const apiBaseUrl=apiKey.endsWith(':fx')?'https://api-free.deepl.com':'https://api.deepl.com';
  let body:unknown;
  try{body=await request.json()}catch{return NextResponse.json({error:'Invalid request.'},{status:400})}
  const texts=typeof body==='object'&&body!==null&&Array.isArray((body as {texts?:unknown}).texts)
    ?(body as {texts:unknown[]}).texts.filter((text):text is string=>typeof text==='string'&&text.trim().length>0):[];
  const unique=[...new Set(texts)].slice(0,MAX_ITEMS);
  if(!unique.length||unique.reduce((sum,text)=>sum+text.length,0)>MAX_CHARACTERS)return NextResponse.json({error:'Translation batch is empty or too large.'},{status:400});
  const translatedEntries=new Map<string,string>();
  for(const text of unique){
    const cached=translationCache.get(text);
    if(cached!==undefined){
      translatedEntries.set(text,cached);
      remember(text,cached);
    }
  }
  const missing=unique.filter(text=>!translatedEntries.has(text));
  if(!missing.length){
    return NextResponse.json(
      {translations:Object.fromEntries(translatedEntries)},
      {headers:{'X-Translation-Cache':'HIT'}},
    );
  }
  let response:Response|undefined;
  try{
    for(const delay of [0,750,1500,3000]){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      response=await fetch(`${apiBaseUrl}/v2/translate`,{
        method:'POST',
        headers:{
          'Authorization':`DeepL-Auth-Key ${apiKey}`,
          'Content-Type':'application/json',
        },
        body:JSON.stringify({text:missing,source_lang:'ZH',target_lang:'EN-US'}),
      });
      if(response.status!==429&&response.status<500)break;
    }
  }catch(error){
    console.error('DeepL API connection error',error);
    return NextResponse.json({error:'Translation service is temporarily unavailable.'},{status:502});
  }
  if(!response){
    console.error('DeepL API error: no response received');
    return NextResponse.json({error:'Translation service is temporarily unavailable.'},{status:502});
  }
  if(!response.ok){
    const detail=await response.text();console.error('DeepL API error',response.status,detail.slice(0,500));
    return NextResponse.json({error:'Translation service is temporarily unavailable.'},{status:502});
  }
  const result=await response.json() as {translations?:Array<{text?:string}>};
  const translations=result.translations?.map(item=>item.text||'')||[];
  if(translations.length!==missing.length)return NextResponse.json({error:'Incomplete translation response.'},{status:502});
  missing.forEach((text,index)=>{
    const translated=translations[index];
    remember(text,translated);
    translatedEntries.set(text,translated);
  });
  return NextResponse.json(
    {translations:Object.fromEntries(unique.map(text=>[text,translatedEntries.get(text)||text]))},
    {headers:{'X-Translation-Cache':translatedEntries.size===missing.length?'MISS':'PARTIAL'}},
  );
}
