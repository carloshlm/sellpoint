import type { Messages } from "./es";

// El inglés, ADAPTADO y no traducido (SITIO-WEB-CONTENIDO.md §7). La base es la
// de Estados Unidos; la ortografía y los argumentos de Canadá van en
// `../overrides.ts`.
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
  },
  hero: {
    // El primer punto es tipográfico; el último es el punto amarillo.
    headline: ["Sales.", "That's the point"],
    lead: "Point of sale, inventory and purchasing in one place. Scan, charge and stay on top of your business — from the register or from your phone.",
    primaryCta: "Start free",
    secondaryCta: "See what it does",
    trustLine: "14 days with every feature. No credit card. Nothing to install.",
  },
  footer: {
    tagline: "Sales. That's the point.",
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
