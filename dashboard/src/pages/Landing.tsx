import React from "react";

const outcomes = [
  ["Answer from your business", "Give customers reliable answers from your website, uploaded knowledge and connected business systems."],
  ["Complete real customer jobs", "Find products, check orders, book appointments, collect leads, create tickets and run approved actions inside the conversation."],
  ["Know when to hand over", "Move conversations to your team with the customer context already attached instead of leaving people stuck with a bot."],
  ["Improve from real conversations", "See what customers ask, where they struggle and which answers or workflows need attention."],
  ["Work across channels", "Use the same assistant knowledge and rules on your website and connect additional customer channels as your business grows."],
  ["Stay in control", "Choose what each assistant can discuss and which connected actions it can use. Sensitive actions remain permission-controlled."],
];

const plans = [
  { key:"starter" as const,name:"Starter",price:"£29",desc:"Start answering customer questions 24/7.",items:["1 assistant","500 conversations / month","Website chat & knowledge","Customer support tickets","Your branding"] },
  { key:"growth" as const,name:"Growth",price:"£79",desc:"Let ZoChat work with the systems your team already uses.",popular:true,items:["3 assistants","2,500 conversations / month","Everything in Starter","Live integrations & business actions","Workflows and rich chat experiences","Assistant testing","Team access & human takeover","Customer insights"] },
  { key:"scale" as const,name:"Scale",price:"£199",desc:"For larger teams, agencies and advanced automation.",items:["10 assistants","10,000 conversations / month","Everything in Growth","Custom API actions","Advanced permissions","Audit & operations controls","Higher usage limits"] },
];

const faqs = [
  ["What does ZoChat actually do?","ZoChat is an AI customer assistant for your business. It can answer from your approved knowledge and, when you connect supported systems, help customers with jobs such as product discovery, order questions, appointments, lead capture and support."],
  ["Do I need to be technical?","No. Everyday setup is designed around plain-language choices: what the assistant should know, what jobs it should handle, which integrations to connect and where to deploy it. Developer controls are kept in advanced areas."],
  ["Can it use my live business data?","Yes, on plans that include live integrations. ZoChat can use server-side, permission-controlled actions for connected commerce, CRM, scheduling, support, messaging, email, automation and data systems."],
  ["Can customers buy or book through chat?","When the connected system supports it, ZoChat can show rich product or booking experiences and run approved actions. Availability depends on the integration and permissions you connect."],
  ["What if the AI cannot solve something?","You decide its boundaries. It can explain that it does not have the answer, collect the right details, create a support request or hand the conversation to a person when your plan and setup support it."],
  ["Can I test it before customers use it?","Yes. Growth and Scale include saved assistant testing so you can keep important customer questions and expected behaviour, then re-check them as you change knowledge, workflows and integrations."],
  ["Does it work for non-ecommerce businesses?","Yes. Service businesses can use website knowledge, appointments, leads, CRM, support and custom business data without enabling ecommerce features."],
  ["Can I manage more than one business or assistant?","Yes. ZoChat supports separate workspaces and multiple assistants depending on your plan, with isolated configuration and permissions."],
];

export default function Landing({onLogin,onChoosePlan}:{onLogin:()=>void;onChoosePlan:(plan:"starter"|"growth"|"scale")=>void}){
 React.useEffect(()=>{document.title="ZoChat — AI customer service that can actually help"},[]);
 return <div className="landing">
  <header className="lp-nav"><a className="lp-logo" href="#top"><span>◆</span> ZoChat</a><nav><a href="#outcomes">What it does</a><a href="#how">How it works</a><a href="#integrations">Integrations</a><a href="#pricing">Pricing</a></nav><button className="lp-login" onClick={onLogin}>Log in</button><button className="lp-nav-cta" onClick={onLogin}>Start free trial <span>→</span></button></header>
  <main id="top">
   <section className="lp-hero"><div className="lp-glow lp-glow-a"/><div className="lp-glow lp-glow-b"/><div className="lp-eyebrow"><i/> AI customer service built around your business</div><h1>Customers get help.<br/><em>Your team gets time back.</em></h1><p className="lp-lead">ZoChat answers questions from your real business knowledge and can use approved integrations to find products, check orders, book appointments, collect leads and handle support — 24/7.</p><div className="lp-actions"><button className="lp-primary" onClick={onLogin}>Start your 14-day free trial <span>→</span></button><a className="lp-secondary" href="#how">See how it works</a></div><p className="lp-micro">No code for everyday setup · Add to your website with one snippet · Cancel anytime</p>
    <div className="lp-product-shot">
      <div className="lp-window">
        <div className="lp-windowbar"><b>ZoChat</b><span/><span/><span/></div>
        <div className="lp-dash">
          <aside><strong>◆ ZoChat</strong><small>YOUR BUSINESS</small>{["Home","Assistants","Inbox","Customers","Knowledge","Integrations","Insights"].map((x,i)=><div className={i===0?"sel":""} key={x}>{x}</div>)}</aside>
          <div className="lp-dashmain">
            <div className="lp-dashhead"><div><small>TODAY</small><h3>What needs your attention</h3></div><button>Assistant live ●</button></div>
            <div className="lp-stats"><div><small>CUSTOMER CONVERSATIONS</small><b>1,284</b><span>Customers helped this month</span></div><div><small>HANDLED BY ZOCHAT</small><b>81%</b><span>Without team intervention</span></div><div><small>NEEDS A PERSON</small><b>12</b><span>Open in your inbox</span></div></div>
            <div className="lp-chart"><div><small>CUSTOMER DEMAND</small><b>Conversations this month</b></div><svg viewBox="0 0 600 130" preserveAspectRatio="none"><path d="M0,105 C45,100 50,62 92,75 S160,112 205,70 S270,25 320,52 S390,95 440,55 S520,18 600,30" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M0,105 C45,100 50,62 92,75 S160,112 205,70 S270,25 320,52 S390,95 440,55 S520,18 600,30 L600,130 L0,130Z" fill="currentColor" opacity=".07"/></svg></div>
          </div>
        </div>
      </div>
      <div className="lp-chat-card"><div className="lp-chat-head"><span className="lp-avatar">◆</span><div><b>Customer Assistant</b><small><i/> Online now</small></div></div><div className="lp-msg user">Show me rings under £200</div><div className="lp-msg bot"><b>Four-Claw Moissanite Ring</b><br/>£159.99<br/><small>In stock</small></div><button className="lp-chat-action">Add to cart</button><div className="lp-msg user">Can I get it delivered this week?</div><div className="lp-msg bot">I can check the delivery options for you.</div></div>
    </div>
   </section>
   <section className="lp-proof"><span>CONNECT THE TOOLS YOU ALREADY USE</span><div><b>WooCommerce</b><b>Shopify</b><b>Stripe</b><b>Calendly</b><b>HubSpot</b><b>WhatsApp</b></div></section>
   <section className="lp-section" id="outcomes"><div className="lp-section-kicker">WHAT ZOCHAT DOES</div><h2>Not another chatbot that<br/><em>only knows how to talk.</em></h2><p className="lp-section-intro">ZoChat is designed around customer outcomes: answer the question, complete the job when possible, and involve your team when needed.</p><div className="lp-feature-grid">{outcomes.map(([t,d],i)=><article key={t}><span className="lp-feature-icon">{["◎","↗","◇","⌁","▦","✦"][i]}</span><h3>{t}</h3><p>{d}</p></article>)}</div></section>
   <section className="lp-dark" id="how"><div className="lp-section-kicker">SIMPLE TO SET UP</div><h2>Tell it. Connect it.<br/>Put it to work.</h2><div className="lp-steps"><article><b>01</b><h3>Teach ZoChat your business</h3><p>Add your website and knowledge, then tell the assistant in plain English what it should help customers with.</p></article><article><b>02</b><h3>Connect the jobs it can do</h3><p>Connect the systems you use. Turn on useful workflows such as order help, booking, lead capture or customer support.</p></article><article><b>03</b><h3>Test, deploy and improve</h3><p>Test important customer questions, add ZoChat to your website, then use Insights to see what customers need next.</p></article></div></section>
   <section className="lp-section lp-integrations" id="integrations"><div className="lp-copy"><div className="lp-section-kicker">INTEGRATIONS</div><h2>Your business systems,<br/><em>available in the conversation.</em></h2><p>Connect commerce, payments, CRM, support, scheduling, messaging, knowledge and automation tools. ZoChat only exposes the actions you allow, and sensitive changes stay permission-controlled.</p><div className="lp-checks"><span>✓ Products, carts, orders & inventory</span><span>✓ Appointments & lead capture</span><span>✓ CRM contacts & support cases</span><span>✓ Email, messaging & human handover</span><span>✓ Customer-safe interactive actions</span><span>✓ Custom APIs on Scale</span></div></div><div className="lp-orbit"><div className="lp-core">◆<b>ZoChat</b><small>Your customer assistant</small></div>{["WooCommerce","Shopify","Calendly","HubSpot","WhatsApp","Stripe"].map((x,i)=><div key={x} className={`lp-node n${i}`}>{x}</div>)}</div></section>
   <section className="lp-section lp-pricing" id="pricing"><div className="lp-section-kicker">PRICING</div><h2>Start with support.<br/><em>Add automation as you grow.</em></h2><p className="lp-section-intro">Every plan starts with a 14-day free trial. Choose the level that matches what you want ZoChat to do for customers.</p><div className="lp-price-grid">{plans.map(p=><article className={p.popular?"popular":""} key={p.name}>{p.popular&&<div className="lp-popular">MOST POPULAR</div>}<h3>{p.name}</h3><p>{p.desc}</p><div className="lp-price"><b>{p.price}</b><span>/ month<br/><small>ex VAT</small></span></div><button onClick={()=>onChoosePlan(p.key)}>Start 14-day trial <span>→</span></button><ul>{p.items.map(x=><li key={x}>✓ {x}</li>)}</ul></article>)}</div></section>
   <section className="lp-answer-section"><div><div className="lp-section-kicker">BUILT AROUND THE CUSTOMER</div><h2>What happens when someone asks ZoChat for help?</h2></div><div><p>ZoChat first uses the knowledge and rules you approved. If the customer needs live information or an action, it can use a connected capability such as product search, order lookup, appointment booking or support.</p><p>If the request needs a person, ZoChat can preserve the conversation context for your team instead of making the customer start again.</p></div></section>
   <section className="lp-section lp-faq" id="faq"><div className="lp-section-kicker">FAQ</div><h2>Questions, answered.</h2><div className="lp-faq-list">{faqs.map(([q,a])=><details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>
   <section className="lp-final"><div className="lp-glow lp-glow-c"/><div className="lp-section-kicker">READY TO TRY IT?</div><h2>Give customers a faster way<br/><em>to get things done.</em></h2><p>Start with your knowledge. Connect the systems you need when you're ready.</p><button className="lp-primary" onClick={onLogin}>Start your 14-day free trial <span>→</span></button></section>
  </main>
  <footer className="lp-footer"><a className="lp-logo" href="#top"><span>◆</span> ZoChat</a><p>AI customer service built around your business.</p><div><a href="#outcomes">What it does</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><button onClick={onLogin}>Log in</button></div><small>© {new Date().getFullYear()} ZoChat. All rights reserved.</small></footer>
 </div>
}
