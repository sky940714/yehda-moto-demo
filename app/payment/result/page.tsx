import Link from "next/link";
import "../../legal.css";

export const metadata = { title: "付款結果｜燁達機車精品店" };

export default async function PaymentResultPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const order = Array.isArray(values.order) ? values.order[0] : values.order;
  return <main className="legalPage paymentResultPage">
    <p className="legalKicker">PAYMENT RESULT</p>
    <h1>付款流程已完成</h1>
    <p>綠界會另外將付款結果傳回燁達系統。請回到會員中心查看最新付款與訂單狀態。</p>
    {order && <p className="legalUpdated">訂單編號：<strong>{order}</strong></p>}
    <p>如果狀態仍顯示「待付款」，請稍候一分鐘後重新整理；請勿重複建立訂單。</p>
    <p><Link href="/?member=orders">查看我的訂單</Link>　<Link href="/">返回商店</Link></p>
  </main>;
}

