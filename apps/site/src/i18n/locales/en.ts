import type { Messages } from "./es";

// El inglés, ADAPTADO y no traducido (SITIO-WEB-CONTENIDO.md §7). La base es la
// de Estados Unidos; la ortografía y los argumentos de Canadá van en
// `../overrides.ts`.
//
// Reglas del glosario: un «ticket» es «receipt» (en inglés un *ticket* es una
// multa), el precio es «Price», lo vencido es «Expired», y en el texto de venta
// se dice «the history of every product», no «stock ledger».
export const en: Messages = {
  meta: {
    title: "SellPointy — Point of sale, inventory and purchasing in one place",
    description:
      "Point of sale and real inventory in one place — in English or Spanish, at a price a small shop can carry. Try every feature for 14 days. No credit card.",
  },
  a11y: {
    skipToContent: "Skip to content",
  },
  nav: {
    label: "Main",
    home: "SellPointy, go to the top",
    whatItDoes: "What it does",
    benefits: "Benefits",
    plans: "Plans",
    faq: "FAQ",
    login: "Log in",
    cta: "Start free",
    ctaShort: "Start free",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  hero: {
    // El primer punto es tipográfico; el último es el punto amarillo.
    headline: ["Sales.", "That's the point"],
    lead: "Point of sale, inventory and purchasing in one place. Scan, charge and stay on top of your business — from the register or from your phone.",
    primaryCta: "Start free",
    secondaryCta: "See what it does",
    trustLine: "14 days with every feature. No credit card. Nothing to install.",
    mock: {
      label: "Example of a sale in SellPointy",
      badge: "Scanned!",
      title: "Current sale",
      register: "Register 1",
      total: "Total",
      pay: "Charge",
      items: {
        first: { name: "Spring water 1 L", detail: "Qty 2" },
        second: { name: "Oatmeal cookies 6 oz", detail: "Qty 1" },
        third: { name: "Olive oil 17 fl oz", detail: "Qty 1" },
      },
    },
  },
  planTags: {
    fromPro: "From Pro",
    onPlus: "On Plus",
  },
  whatItDoes: {
    eyebrow: "What it does",
    title: "Everything that happens at your counter, on one screen.",
    sub: "Stop jumping between a notebook, a spreadsheet and a calculator. SellPointy connects what you sell with what you have and what you buy.",
    items: {
      sell: {
        title: "Sell",
        text: "Ring up sales with a barcode scanner, a Bluetooth gun or your phone's camera. Receipts with your logo, and cash shifts with a till count so you close the day with no surprises.",
      },
      track: {
        title: "Track",
        text: "Entries, exits, transfers and physical counts. The history of every product, across all your stores.",
      },
      buy: {
        title: "Buy",
        text: "Record your purchases with their invoice and keep your costs current, so the price you set leaves the margin you expect.",
      },
      decide: {
        title: "Decide",
        text: "Sales and expense reports, ready to read and ready to export. Nothing to build by hand.",
      },
    },
  },
  benefits: {
    eyebrow: "Benefits for your business",
    title: "What you do by hand today costs you time and money.",
    painLabel: "Today",
    items: {
      fast: {
        pain: "You key in every price or look it up on a list while the line grows. And a price charged from memory is money that slips away unnoticed.",
        title: "Ring up sales in *seconds*, not lines.",
        text: "Scan it and it's on the bill. Nobody waits while you look up a price.",
      },
      catalog: {
        pain: "Your price list lives in a notebook or a spreadsheet nobody updates, and everyone charges what they remember.",
        title: "Build your catalog in *one afternoon*.",
        text: "Scan the barcode and SellPointy recognizes the product and suggests its name — you just set the price. Already have it in a spreadsheet? Upload it in one go.",
      },
      shift: {
        pain: "You count the till with a calculator at the end of the day. If money is missing, you don't know when it went or on whose shift.",
        title: "Close the register with *no surprises*.",
        text: "Every shift opens and closes with its own till count. You know who rang up what, how much, and whether it adds up.",
      },
      stock: {
        pain: "You find out something ran out when a customer asks for it — that sale is already lost. And to know what to reorder, you count shelf by shelf.",
        title: "Know *what you have* without counting by hand.",
        text: "Every sale comes off the shelf and every purchase goes back on. Your stock is a number, not a hunch.",
      },
      expiry: {
        pain: "You find expired product at the back of the shelf. What you throw out is money you already paid.",
        title: "Let nothing *expire* on the shelf.",
        text: "Lots with dates, and a clear heads-up on what's about to expire — so you sell it in time instead of throwing it out.",
      },
      pocket: {
        pain: "To know how the day is going you have to be at the store, or call and trust what you're told.",
        title: "Your whole business, *in your pocket*.",
        text: "Computer, tablet or phone. Log in from anywhere and see exactly what the register sees.",
      },
    },
  },
  inAction: {
    eyebrow: "At your counter",
    title: "Scan, charge and hand over the receipt.",
    sub: "This is what a sale looks like in SellPointy: scan the product, it shows up on screen with its price, and you charge. No typing prices, no hunting through a list.",
    steps: {
      scan: { title: "Scan", text: "The product lands on the sale with its name and price." },
      charge: { title: "Charge", text: "The total adds itself up. You just confirm." },
      ticket: { title: "Hand over the receipt", text: "With your logo, ready for your customer." },
    },
    imageAlt:
      "A cashier scans a bottle of water with a barcode scanner; next to her, a tablet shows the sale in SellPointy and a printer delivers the receipt.",
    caption: "Illustrative image.",
  },
  insights: {
    eyebrow: "Your dashboard",
    title: "Open SellPointy and see how your day is going.",
    sub: "Sales, profit and transactions as they happen, from the register or from your phone. No waiting for closing time, no building a report.",
    points: [
      "What you sold today and this month, against your goal.",
      "Your profit: what you sold minus what it cost you.",
      "Your best sellers and the hours you sell the most.",
    ],
    note: "Included in every plan.",
    mock: {
      label: "Example of the SellPointy dashboard with sales for the day and the month",
      badge: "Live",
      title: "Dashboard",
      tabs: { today: "Today", week: "This week", month: "This month" },
      today: "Sales today",
      month: "Sales this month",
      goal: "{percent}% of goal",
      profit: "Profit this month",
      tickets: "Transactions today",
      average: "{amount} average",
      trend: "Sales: this month vs. last month",
      current: "This month",
      previous: "Last month",
      hourly: "Sales today by hour",
      top: "Best sellers",
      units: "{count} units",
    },
  },
  whoFor: {
    eyebrow: "Who it's for",
    title: "Built for the business you run yourself.",
    // Sin farmacias: en Estados Unidos y Canadá viven bajo una regulación
    // sanitaria y de recetas que SellPointy no cubre (§7.4).
    trades: [
      "Grocery stores",
      "Restaurants",
      "Convenience stores",
      "Latin markets",
      "Hardware stores",
      "Gift shops",
      "Boutiques",
      "Auto parts",
      "Bakeries",
      "Coffee shops",
      "Candy shops",
      "Health food stores",
      "Pet supplies",
    ],
    // No se muestra en ningún mercado de habla inglesa (`CLINICS_MARKETS`).
    clinics: "Medical offices",
  },
  plans: {
    eyebrow: "Plans",
    title: "Start with what you need. Grow when you're ready.",
    lead: "The first 14 days you get all of Plus. Then you pick.",
    recommended: "Recommended",
    users: "{count} users",
    warehouseOne: "{count} store",
    warehouseMany: "{count} stores",
    cards: {
      basic: {
        tagline: "Start ringing up sales the right way",
        includes: "Includes:",
        cta: "I want Basic",
        note: "Basic doesn't track stock. If you need to know what you have, Pro is your plan.",
      },
      pro: {
        tagline: "Take control of your inventory",
        includes: "Everything in Basic, plus:",
        cta: "I want Pro",
      },
      plus: {
        tagline: "Run a serious operation",
        includes: "Everything in Pro, plus:",
        cta: "I want Plus",
      },
    },
    premium: {
      text: "Need something built for your business? Custom modules, with unlimited users and stores.",
      cta: "Get in touch",
    },
    appLanguageNote: "The app is available in English and Spanish.",
    compare: {
      toggle: "See everything each plan includes",
      feature: "Feature",
      planTabs: "Plan shown",
      included: "Included",
      notIncluded: "Not included",
    },
    lines: {
      pos: "Point of sale and receipts",
      cashShift: "Cash shift with till count",
      ticket: "Receipt with your logo, 58 or 80 mm",
      reports: "Reports",
      reports_export: "Export reports",
      expenses: "Expenses",
      stockControl: "Inventory control",
      movements: "Entries, exits and stock ledger",
      transfers: "Transfers between stores",
      quotes: "Quotes",
      compositions: "Composite products: recipes and kits",
      purchases: "Purchases",
      purchase_orders: "Purchase orders and partial receipts",
      lots: "Lots and expiration dates",
      custom_fields: "Subcatalogs and custom fields",
      custom_roles: "Custom roles",
      custom_modules: "Modules tailored to your business",
    },
    prices: {
      cycleLabel: "Billing cycle",
      monthly: "Monthly",
      yearly: "Yearly",
      perMonth: "/month",
      perYear: "/year",
      yearlyDeal: "Pay for 10 months, use 12",
      pricesFor: {
        mx: "Prices for Mexico.",
        us: "Prices for the United States.",
        ca: "Prices for Canada.",
      },
      otherCountry: "Are you in another country?",
      paidByTransfer: "Prices in {currency}. Paid by bank transfer.",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "What everyone asks before getting started.",
    items: {
      install: {
        q: "Do I need to install anything?",
        a: "No. SellPointy runs in the browser on your computer, tablet or phone. You log in with your email and that's it.",
      },
      scanner: {
        q: "What barcode scanner do I need?",
        a: "Any of them: USB scanners and Bluetooth guns work as soon as you plug them in. And if you don't have one, your phone or tablet camera scans too.",
      },
      printer: {
        q: "What receipt printer do I need?",
        a: "Any 58 or 80 mm thermal printer your computer, tablet or phone recognizes: USB, Bluetooth or network. SellPointy builds the receipt to fit the paper and prints it from the browser, with nothing to install. And if you don't hand out receipts, you don't need a printer: the sale is recorded either way.",
      },
      spreadsheet: {
        q: "Can I upload the products I already have in a spreadsheet?",
        a: "Yes. Download the template, paste your products and upload them in one go. Anything with a barcode you can also add just by scanning it.",
      },
      trialEnd: {
        q: "What happens when the 14 days are up?",
        a: "You pick the plan that fits. If you haven't decided yet, your information isn't deleted — it stays right there waiting for you.",
      },
      payment: {
        q: "How do I pay?",
        a: "By bank transfer, monthly or yearly. Pay for the full year and you pay for 10 months and use 12.",
      },
      changePlan: {
        q: "Can I change plans later?",
        a: "Yes. Write to us from the “My plan” screen in your account, tell us which plan you want, and we'll activate it.",
      },
      data: {
        q: "Is my information mine?",
        a: "Yes. Your sales, prices, customers and stock are yours alone: they are never shared or sold. The only thing in common is the barcode catalog — the name printed on the package — which is what lets you add a product just by scanning it.",
      },
      languages: {
        q: "What languages is it in?",
        a: "English and Spanish. Each person on your team picks their own.",
      },
      staffLanguage: {
        q: "Can my staff use it in Spanish?",
        a: "Yes. Each person picks their own language, English or Spanish, on the same account.",
      },
      // NO se dice «your sales tax is set up for you»: `tax-defaults.ts` siembra
      // la tasa ESTATAL base, sin la local. Prometer más es un ticket equivocado.
      salesTax: {
        q: "Are sales taxes set up for me?",
        a: "When you create your account, SellPointy starts you off with your state's base sales tax rate. If your city or county adds its own, you adjust it once and you're done.",
      },
      canadaTax: {
        q: "Are taxes set up for me?",
        a: "SellPointy sets up GST, HST or PST for your province when you sign up. You can adjust them at any time.",
      },
    },
  },
  closing: {
    title: "Put an end to the mess.",
    text: "Create your account, scan your first products and make your first sale today. Prefer to talk first? Drop us a line.",
    primaryCta: "Start free",
    secondaryCta: "Contact us",
  },
  leadForm: {
    title: "Tell us about your business",
    lead: "We usually reply within one business day, to help you choose and get started.",
    name: "Name",
    email: "Email",
    country: "Country",
    otherCountry: "Another country",
    plan: "Plan you're interested in",
    planOptions: {
      basic: "Basic",
      pro: "Pro",
      plus: "Plus",
      custom: "Something custom",
      undecided: "Not sure yet",
    },
    businessType: "Type of business",
    businessTypeEmpty: "Pick one (optional)",
    businessTypeOther: "Other",
    message: "Anything we should know?",
    optional: "optional",
    consent:
      "I agree to SellPointy emailing me about my request. I can ask them to stop at any time.",
    privacyLink: "Privacy notice",
    submit: "Send",
    sending: "Sending…",
    successTitle: "All set, {name}!",
    successText:
      "We got your message and will write to {email}. Meanwhile, you can start your free trial — 14 days with everything.",
    successCta: "Start my free trial",
    error: "We couldn't send your message. Please try again, or write to us at {email}.",
    tooMany: "We received several messages from your connection. Please try again in a while.",
    errors: {
      required: "This field is required.",
      email: "Check the email address: it looks incomplete.",
      consent: "We need your permission to be able to write to you.",
    },
  },
  construction: {
    text: "Our website is on its way. In the meantime, SellPointy is up and running: log in, or create an account and try it for 14 days.",
  },
  notFound: {
    title: "This page doesn't exist.",
    text: "The address may be mistyped, or the page may have moved.",
    cta: "Go to the home page",
  },
  legal: {
    toc: "Contents",
    print: "Print",
    backHome: "Back to home",
  },
  footer: {
    privacy: "Privacy notice",
    terms: "Terms",
    tagline: "Sales. That's the point.",
    navLabel: "Footer",
  },
  markets: {
    mx: "Mexico",
    us: "United States",
    ca: "Canada",
  },
  geo: {
    switcher: {
      label: "Country and language",
    },
    notice: {
      question: {
        mx: "Are you in Mexico?",
        us: "Are you in the United States?",
        ca: "Are you in Canada?",
      },
      link: {
        mx: "See the site for Mexico",
        us: "See the site for the United States",
        ca: "See the site for Canada",
      },
      close: "Dismiss",
    },
  },
};
