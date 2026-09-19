import type { Messages } from "./es";

// El francés, NEUTRO y de « vous » (SITIO-WEB-CONTENIDO.md §8).
//
// La puntuación francesa lleva espacio antes de `? ! : ;` y dentro de « ». Ese
// espacio es de NO separación —` ` (fino) o ` `—, escrito con su
// código para que se vea en el editor: con un espacio normal, el signo puede
// quedar solo al inicio de un renglón. `test/i18n.test.ts` lo vigila.
export const fr: Messages = {
  meta: {
    title: "SellPointy — Point de vente, stocks et achats au même endroit",
    description:
      "Le point de vente avec une vraie gestion des stocks — lots, dates de péremption et plusieurs entrepôts — sans le prix d'un système d'entreprise. 14 jours d'essai, sans carte bancaire.",
  },
  a11y: {
    skipToContent: "Aller au contenu",
  },
  nav: {
    label: "Principal",
    home: "SellPointy, retour en haut de la page",
    whatItDoes: "Fonctions",
    benefits: "Avantages",
    plans: "Forfaits",
    faq: "Questions",
    login: "Se connecter",
    cta: "Commencer gratuitement",
  },
  hero: {
    headline: ["Vos ventes.", "Un point, c'est tout"],
    lead: "Point de vente, stocks et achats au même endroit. Scannez, encaissez et gardez le contrôle de votre commerce, à la caisse ou sur votre téléphone.",
    primaryCta: "Commencer gratuitement",
    secondaryCta: "Découvrir les fonctions",
    trustLine: "14 jours avec toutes les fonctionnalités. Sans carte bancaire. Rien à installer.",
  },
  footer: {
    tagline: "Vos ventes. Un point, c'est tout.",
  },
  markets: {
    mx: "Mexique",
    us: "États-Unis",
    ca: "Canada",
  },
  geo: {
    switcher: {
      label: "Pays et langue",
    },
    // Cada país con SU preposición: « au Canada », « aux États-Unis », « au Mexique ».
    notice: {
      question: {
        mx: "Vous êtes au Mexique ?",
        us: "Vous êtes aux États-Unis ?",
        ca: "Vous êtes au Canada ?",
      },
      link: {
        mx: "Voir le site pour le Mexique",
        us: "Voir le site pour les États-Unis",
        ca: "Voir le site pour le Canada",
      },
      close: "Fermer",
    },
  },
};
