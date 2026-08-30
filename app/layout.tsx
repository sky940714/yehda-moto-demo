import type {Metadata} from 'next';import './globals.css';import './features.css';import './priority.css';import './mobile.css';
export const metadata:Metadata={title:'燁達機車精品｜性能改裝・義大利精品部品',description:'燁達機車精品，嚴選 POLINI、MALOSSI 義大利性能部品與安全帽，支援依車種精準選購。'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body>{children}</body></html>}
