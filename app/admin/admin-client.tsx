"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogOptionKind, CatalogOptions, CatalogProduct, ProductSpecification } from "../../db/catalog";
import "./admin.css";
import "./admin-login.css";
import "./admin-modules.css";
import "./admin-bulk.css";

type Props = { user: { name: string; role: string } };
type Tab = "overview" | "products" | "categories" | "brands" | "vehicles" | "orders" | "returns" | "members" | "settings";
type Overview = { products: number; orders: number; pendingOrders: number; revenue: number };
type ApiError = { error?: string };

const empty: Partial<CatalogProduct> = { name: "", brand: "", cat: "", price: 0, stock: 0, status: "draft", color: "smoke", fit: [], image: undefined, images: [], specifications: [], description: "", shippingType: "small" };
const emptyOptions: CatalogOptions = { brands: [], categories: [], vehicles: [] };
const nav: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "數據總覽", icon: "⌁" },
  { id: "products", label: "商品管理", icon: "□" },
  { id: "categories", label: "分類管理", icon: "▦" },
  { id: "brands", label: "品牌管理", icon: "◆" },
  { id: "vehicles", label: "車種資料庫", icon: "⌖" },
  { id: "orders", label: "訂單管理", icon: "▤" },
  { id: "returns", label: "退貨管理", icon: "↩" },
  { id: "members", label: "會員管理", icon: "♙" },
  { id: "settings", label: "網站設定", icon: "⚙" },
];

const moduleCopy: Record<Exclude<Tab, "overview" | "products" | "categories" | "brands" | "vehicles" | "orders">, { eyebrow: string; title: string; text: string; features: string[] }> = {
  returns: { eyebrow: "RETURN WORKFLOW", title: "目前沒有正式退貨申請", text: "退貨入口已恢復。之後會接上申請審核、退款、商品回收與庫存回補。", features: ["退貨申請審核", "退款狀態", "退回物流", "庫存回補"] },
  members: { eyebrow: "CUSTOMER DATABASE", title: "會員管理入口已恢復", text: "不再顯示假會員。下一階段會從正式會員資料庫載入會員、訂單與帳號狀態。", features: ["會員搜尋", "帳號狀態", "歷史訂單", "權限與操作紀錄"] },
  settings: { eyebrow: "STORE SETTINGS", title: "網站設定入口已恢復", text: "之後可以集中管理商店資料、首頁內容、付款、物流與系統通知。", features: ["商店基本資料", "首頁內容", "付款與物流", "通知設定"] },
};

export default function AdminClient({ user }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [overview, setOverview] = useState<Overview>({ products: 0, orders: 0, pendingOrders: 0, revenue: 0 });
  const [editing, setEditing] = useState<Partial<CatalogProduct> | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [options, setOptions] = useState<CatalogOptions>(emptyOptions);

  const load = async () => {
    const [p, o, c] = await Promise.all([fetch("/api/admin/products"), fetch("/api/admin/overview"), fetch("/api/admin/catalog-options")]);
    if (p.ok) setProducts(((await p.json()) as { products: CatalogProduct[] }).products);
    if (o.ok) setOverview(((await o.json()) as { overview: Overview }).overview);
    if (c.ok) setOptions(((await c.json()) as { options: CatalogOptions }).options);
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => products.filter((p) => `${p.name}${p.brand}${p.cat}${p.sku}`.toLowerCase().includes(query.toLowerCase())), [products, query]);
  const categories = useMemo(() => aggregate(products.map((p) => p.cat)), [products]);
  const brands = useMemo(() => aggregate(products.map((p) => p.brand)), [products]);
  const vehicles = useMemo(() => aggregate(products.flatMap((p) => p.fit).filter((x) => x !== "全車種")), [products]);

  const signOut = async () => { await fetch("/api/admin/auth", { method: "DELETE" }); location.replace("/admin"); };
  const openTab = (next: Tab) => { setTab(next); setEditing(null); setMessage(""); };
  const beginProduct = () => { setTab("products"); setEditing(empty); };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = { ...editing, name: form.get("name"), sku: form.get("sku"), brand: form.get("brand"), cat: form.get("cat"), price: Number(form.get("price")), stock: Number(form.get("stock")), status: form.get("status"), images: form.getAll("images").map(String), description: form.get("description"), fit: form.getAll("fit").map(String), specifications: JSON.parse(String(form.get("specifications") || "[]")) as ProductSpecification[], shippingType: form.get("shippingType") };
    const response = await fetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json()) as ApiError;
    if (!response.ok) { setMessage(data.error || "儲存失敗"); return; }
    setMessage("商品已儲存並寫入資料庫。"); setEditing(null); await load();
  };
  const remove = async (id: number) => { if (!confirm("確定刪除此商品？此操作會留下管理紀錄。")) return; await fetch(`/api/admin/products?id=${id}`, { method: "DELETE" }); await load(); };
  const toggleSelected = (id:number) => setSelected((current) => { const next=new Set(current); if(next.has(id))next.delete(id);else next.add(id); return next; });
  const toggleShown = () => setSelected((current) => shown.length > 0 && shown.every((product) => current.has(product.id)) ? new Set([...current].filter((id) => !shown.some((product) => product.id === id))) : new Set([...current, ...shown.map((product) => product.id)]));
  const bulkStatus = async (status:CatalogProduct["status"]) => { const ids=[...selected]; if(!ids.length)return; const response=await fetch("/api/admin/products",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids,status})}); const data=(await response.json()) as ApiError & { updated?: number }; if(!response.ok){setMessage(data.error||"批次更新失敗。");return;} setMessage(`已更新 ${data.updated ?? 0} 項商品。`);setSelected(new Set());await load(); };
  const bulkDelete = async () => { const ids=[...selected];if(!ids.length||!confirm(`確定刪除已選取的 ${ids.length} 項商品？此操作無法復原。`))return;const response=await fetch("/api/admin/products",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids})});const data=(await response.json()) as ApiError & { deleted?: number };if(!response.ok){setMessage(data.error||"批次刪除失敗。");return;}setMessage(`已刪除 ${data.deleted ?? 0} 項商品。`);setSelected(new Set());await load();};
  const upload = async (file: File) => { setMessage(`正在上傳 ${file.name}…`); const form = new FormData(); form.set("file", file); const response = await fetch("/api/admin/uploads", { method: "POST", body: form }); const data = (await response.json()) as ApiError & { url?: string }; if (!response.ok || !data.url) { setMessage(data.error || "圖片上傳失敗。"); return undefined; } setMessage("圖片已上傳至 Cloudflare R2。"); return data.url; };
  const addOption = async (kind:CatalogOptionKind,label:string) => { const name=prompt(`新增${label}名稱`)?.trim();if(!name)return;const response=await fetch("/api/admin/catalog-options",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,name})});const data=(await response.json()) as ApiError;if(!response.ok){setMessage(data.error||`新增${label}失敗。`);return;}setMessage(`${label}「${name}」已加入資料庫。`);await load(); };
  const exportOverview = () => { const rows = [["指標", "數值"], ["商品總數", overview.products], ["訂單總數", overview.orders], ["待處理訂單", overview.pendingOrders], ["累計營業額", overview.revenue]]; const blob = new Blob(["\ufeff" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `yada-overview-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); };

  const title = nav.find((item) => item.id === tab)?.label || "後台管理";
  return <div className="realAdmin">
    <aside>
      <div className="brand"><b>燁達</b><span>STORE ADMIN</span></div>
      <nav>{nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => openTab(item.id)}><i>{item.icon}</i>{item.label}{item.id === "orders" && overview.pendingOrders > 0 && <em>{overview.pendingOrders}</em>}</button>)}</nav>
      <a href="/">← 返回前台商城</a>
    </aside>
    <main>
      <header><div><small>燁達機車精品 / {title}</small><h1>{title}</h1></div><div className="identity"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><b>{user.name}</b><small>{user.role.toUpperCase()}</small></div><button onClick={signOut}>登出</button></div></header>
      {message && <div className="notice">{message}</div>}
      {tab === "overview" && <OverviewPanel overview={overview} beginProduct={beginProduct} openTab={openTab} exportOverview={exportOverview} />}
      {tab === "products" && <ProductsPanel products={shown} query={query} setQuery={setQuery} setEditing={setEditing} remove={remove} beginProduct={beginProduct} selected={selected} toggleSelected={toggleSelected} toggleShown={toggleShown} bulkStatus={bulkStatus} bulkDelete={bulkDelete} clearSelected={()=>setSelected(new Set())} />}
      {tab === "categories" && <IndexPanel eyebrow="PRODUCT CATEGORIES" title="商品分類" names={options.categories} counts={categories} noun="項商品" empty="目前沒有商品分類" onAdd={()=>addOption("category","分類")} />}
      {tab === "brands" && <IndexPanel eyebrow="PRODUCT BRANDS" title="品牌資料" names={options.brands} counts={brands} noun="項商品" empty="目前沒有品牌資料" onAdd={()=>addOption("brand","品牌")} />}
      {tab === "vehicles" && <IndexPanel eyebrow="FITMENT DATABASE" title="適用車種" names={options.vehicles} counts={vehicles} noun="項相容商品" empty="目前沒有車種資料" onAdd={()=>addOption("vehicle","車種")} />}
      {tab === "orders" && <OrdersPanel count={overview.orders} pending={overview.pendingOrders} />}
      {(tab === "returns" || tab === "members" || tab === "settings") && <ModulePanel {...moduleCopy[tab]} />}
      {editing && <ProductModal editing={editing} setEditing={setEditing} save={save} upload={upload} options={options} />}
    </main>
  </div>;
}

function OverviewPanel({ overview, beginProduct, openTab, exportOverview }: { overview: Overview; beginProduct: () => void; openTab: (tab: Tab) => void; exportOverview: () => void }) {
  return <section className="adminBody">
    <div className="overviewTop"><div><p>REAL-TIME STORE DATA</p><h2>商店營運狀態</h2><span>所有數字皆來自正式資料庫，不顯示模擬交易。</span></div><button onClick={beginProduct}>＋ 新增商品</button></div>
    <div className="metrics">{[["商品總數", overview.products], ["訂單總數", overview.orders], ["待處理訂單", overview.pendingOrders], ["累計營業額", `NT$ ${Number(overview.revenue).toLocaleString()}`]].map(([key, value]) => <article key={key}><small>{key}</small><b>{value}</b></article>)}</div>
    <section className="moduleCard"><div className="moduleHead"><div><p>QUICK ACTIONS</p><h2>快速操作</h2></div></div><div className="quickActions"><button onClick={beginProduct}>＋<span>新增商品</span></button><button onClick={() => openTab("orders")}>＋<span>建立訂單</span></button><button onClick={() => openTab("vehicles")}>＋<span>新增車種</span></button><button onClick={() => openTab("settings")}>＋<span>更新首頁</span></button><button onClick={exportOverview}>↓<span>匯出報表</span></button><button onClick={() => openTab("settings")}>⚙<span>網站設定</span></button></div></section>
  </section>;
}

function ProductsPanel({ products, query, setQuery, setEditing, remove, beginProduct, selected, toggleSelected, toggleShown, bulkStatus, bulkDelete, clearSelected }: { products: CatalogProduct[]; query: string; setQuery: (value: string) => void; setEditing: (product: Partial<CatalogProduct> | null) => void; remove: (id: number) => void; beginProduct: () => void; selected:Set<number>;toggleSelected:(id:number)=>void;toggleShown:()=>void;bulkStatus:(status:CatalogProduct["status"])=>void;bulkDelete:()=>void;clearSelected:()=>void }) {
  const allShownSelected=products.length>0&&products.every((product)=>selected.has(product.id));
  return <section className="adminBody"><div className="toolbar"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋商品、品牌、分類或 SKU"/><button onClick={beginProduct}>＋ 新增商品</button></div>{selected.size>0&&<div className="bulkBar"><b>已選取 {selected.size} 項</b><button onClick={()=>bulkStatus("active")}>批次上架</button><button onClick={()=>bulkStatus("draft")}>移至草稿</button><button onClick={()=>bulkStatus("out_of_stock")}>標示缺貨</button><button className="danger" onClick={bulkDelete}>批次刪除</button><button className="quiet" onClick={clearSelected}>取消選取</button></div>}<div className="productTable"><table><thead><tr><th className="selectCell"><input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="選取目前顯示的所有商品"/></th><th>商品</th><th>分類</th><th>價格</th><th>庫存</th><th>狀態</th><th>操作</th></tr></thead><tbody>{products.map((p) => <tr key={p.id} className={selected.has(p.id)?"selectedRow":""}><td className="selectCell"><input type="checkbox" checked={selected.has(p.id)} onChange={()=>toggleSelected(p.id)} aria-label={`選取 ${p.name}`}/></td><td><b>{p.name}</b><small>{p.brand} · {p.sku}</small></td><td>{p.cat}</td><td>NT$ {p.price.toLocaleString()}</td><td>{p.stock}</td><td><span className={`pill ${p.status}`}>{p.status === "active" ? "上架中" : p.status === "draft" ? "草稿" : "缺貨"}</span></td><td><button onClick={() => setEditing(p)}>編輯</button><button className="danger" onClick={() => remove(p.id)}>刪除</button></td></tr>)}</tbody></table>{!products.length && <div className="tableEmpty">找不到符合條件的商品</div>}</div></section>;
}

function IndexPanel({ eyebrow, title, names, counts, noun, empty, onAdd }: { eyebrow: string; title: string; names:string[]; counts: { name: string; count: number }[]; noun: string; empty: string; onAdd:()=>void }) {
  const countMap=new Map(counts.map((row)=>[row.name,row.count]));
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>{eyebrow}</p><h2>{title}</h2><span>這些選項儲存在資料庫，新增商品時會出現在下拉選單。</span></div><button onClick={onAdd}>＋ 新增項目</button></div>{names.length ? <div className="indexGrid">{names.map((name) => <article key={name}><b>{name}</b><span>{countMap.get(name)||0} {noun}</span></article>)}</div> : <div className="moduleEmpty"><h3>{empty}</h3><p>請先新增一個選項，再建立商品。</p></div>}</section></section>;
}

function OrdersPanel({ count, pending }: { count: number; pending: number }) {
  return <section className="adminBody"><div className="statusStrip"><span>全部訂單 <b>{count}</b></span><span>待處理 <b>{pending}</b></span><button disabled>＋ 建立訂單（下一階段）</button></div><section className="moduleCard"><div className="moduleHead"><div><p>ORDER DATABASE</p><h2>訂單配送資料</h2><span>之後會在這裡處理付款、備貨、物流與訂單狀態。</span></div></div><div className="moduleEmpty"><h3>目前沒有正式訂單</h3><p>假訂單已清除；顧客完成正式結帳後才會出現在這裡。</p></div></section></section>;
}

function ModulePanel({ eyebrow, title, text, features }: { eyebrow: string; title: string; text: string; features: string[] }) {
  return <section className="adminBody"><section className="moduleCard"><div className="moduleHead"><div><p>{eyebrow}</p><h2>{title}</h2><span>{text}</span></div><span className="stageBadge">入口已恢復</span></div><div className="featureGrid">{features.map((feature, index) => <article key={feature}><span>{String(index + 1).padStart(2, "0")}</span><b>{feature}</b><small>等待下一階段實作</small></article>)}</div></section></section>;
}

function ProductModal({ editing, setEditing, save, upload, options }: { editing: Partial<CatalogProduct>; setEditing: (value: Partial<CatalogProduct> | null) => void; save: (e: React.FormEvent<HTMLFormElement>) => void; upload: (file:File) => Promise<string|undefined>; options:CatalogOptions }) {
  const [images,setImages]=useState<string[]>(editing.images?.length?editing.images:(editing.image?[editing.image]:[]));
  const [specifications,setSpecifications]=useState<ProductSpecification[]>(editing.specifications||[]);
  const [uploading,setUploading]=useState(false);
  const [dragIndex,setDragIndex]=useState<number|null>(null);
  const brandOptions=includeCurrent(options.brands,editing.brand),categoryOptions=includeCurrent(options.categories,editing.cat),vehicleOptions=[...new Set([...options.vehicles,...(editing.fit||[])])];
  const addImages=async(files:FileList|null)=>{if(!files)return;const available=8-images.length,selected=[...files].slice(0,available);if(!selected.length)return;setUploading(true);const uploaded:string[]=[];for(const file of selected){const url=await upload(file);if(url)uploaded.push(url);}setImages((current)=>[...current,...uploaded].slice(0,8));setUploading(false);};
  const moveImage=(from:number,to:number)=>setImages((current)=>{if(to<0||to>=current.length||from===to)return current;const next=[...current],item=next.splice(from,1)[0];next.splice(to,0,item);return next;});
  const dropImage=(to:number)=>{if(dragIndex!==null)moveImage(dragIndex,to);setDragIndex(null);};
  const updateSpec=(index:number,key:"name"|"values",value:string)=>setSpecifications((current)=>current.map((spec,i)=>i===index?{...spec,[key]:key==="values"?value.split(",").map((item)=>item.trim()).filter(Boolean):value}:spec));
  return <div className="modal"><form onSubmit={save}><div className="modalHead"><div><small>PRODUCT DATABASE</small><h2>{editing.id ? "編輯商品" : "新增商品"}</h2></div><button type="button" onClick={() => setEditing(null)}>×</button></div><div className="fields">
    <label className="wide">商品名稱<input name="name" required defaultValue={editing.name}/></label>
    <label>商品編號（留空自動產生）<input name="sku" defaultValue={editing.sku} placeholder="例如 YD-20260905-123045-A1B2"/><small>新商品留空即可，儲存時依台灣日期時間產生。</small></label>
    <label>品牌<select name="brand" required defaultValue={editing.brand||""}><option value="" disabled>請選擇品牌</option>{brandOptions.map((name)=><option key={name} value={name}>{name}</option>)}</select><small>{brandOptions.length?"選項來自品牌管理資料庫。":"請先到品牌資料新增選項。"}</small></label>
    <label>分類<select name="cat" required defaultValue={editing.cat||""}><option value="" disabled>請選擇分類</option>{categoryOptions.map((name)=><option key={name} value={name}>{name}</option>)}</select><small>{categoryOptions.length?"選項來自分類管理資料庫。":"請先到商品分類新增選項。"}</small></label>
    <label>售價<input name="price" type="number" min="0" required defaultValue={editing.price}/></label><label>庫存<input name="stock" type="number" min="0" required defaultValue={editing.stock}/></label>
    <label>狀態<select name="status" defaultValue={editing.status}><option value="active">上架中</option><option value="draft">草稿</option><option value="out_of_stock">缺貨</option></select></label><label>配送<select name="shippingType" defaultValue={editing.shippingType}><option value="small">小型／超商</option><option value="home">一般宅配</option><option value="quote">大型／另行報價</option></select></label>
    <fieldset className="wide imageField"><legend>商品圖片（最多 8 張）</legend><label className={`imagePicker ${images.length>=8?"disabled":""}`}>＋ 選擇圖片<input type="file" multiple disabled={uploading||images.length>=8} accept="image/jpeg,image/png,image/webp" onChange={(event)=>{void addImages(event.target.files);event.currentTarget.value="";}}/></label><small>{uploading?"圖片上傳中…":`已選擇 ${images.length}/8 張；拖曳縮圖可調整順序，第一張是前台主圖。`}</small><div className="imagePreviews">{images.map((url,index)=><article key={url} draggable onDragStart={()=>setDragIndex(index)} onDragOver={(event)=>event.preventDefault()} onDrop={()=>dropImage(index)}><img src={url} alt={`商品圖片 ${index+1}`}/>{index===0&&<b>主圖</b>}<span>{index+1}</span><div><button type="button" disabled={index===0} onClick={()=>moveImage(index,index-1)} aria-label="往前移">←</button><button type="button" disabled={index===images.length-1} onClick={()=>moveImage(index,index+1)} aria-label="往後移">→</button><button type="button" onClick={()=>setImages((current)=>current.filter((_,i)=>i!==index))} aria-label="移除圖片">×</button></div><input type="hidden" name="images" value={url}/></article>)}</div></fieldset>
    <fieldset className="wide fitmentField"><legend>適用車種</legend><details><summary>{editing.fit?.length ? `已選擇 ${editing.fit.length} 項` : "請展開選擇適用車種"}</summary><div>{vehicleOptions.length?vehicleOptions.map((name)=><label key={name}><input type="checkbox" name="fit" value={name} defaultChecked={editing.fit?.includes(name)}/><span>{name}</span></label>):<p>請先到車種資料庫新增選項。</p>}</div></details></fieldset>
    <fieldset className="wide specificationField"><legend>商品規格</legend>{specifications.map((spec,index)=><div className="specRow" key={index}><input aria-label="規格名稱" placeholder="規格名稱，例如尺寸" value={spec.name} onChange={(event)=>updateSpec(index,"name",event.target.value)}/><input aria-label="規格選項" placeholder="選項用逗號分隔，例如 M, L, XL" value={spec.values.join(", ")} onChange={(event)=>updateSpec(index,"values",event.target.value)}/><button type="button" onClick={()=>setSpecifications((current)=>current.filter((_,i)=>i!==index))}>移除</button></div>)}<button className="addSpec" type="button" onClick={()=>setSpecifications((current)=>[...current,{name:"",values:[]}])}>＋ 新增規格</button><input type="hidden" name="specifications" value={JSON.stringify(specifications)}/><small>每個規格可設定多個選項，例如「顏色：黑、銀」。</small></fieldset>
    <label className="wide">商品說明<textarea name="description" rows={5} defaultValue={editing.description}/></label>
  </div><div className="actions"><button type="button" onClick={() => setEditing(null)}>取消</button><button type="submit" disabled={uploading}>儲存商品</button></div></form></div>;
}

function includeCurrent(options:string[],current?:string){return current&& !options.includes(current)?[current,...options]:options;}

function aggregate(values: string[]) { const counts = new Map<string, number>(); values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)); return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant")); }
