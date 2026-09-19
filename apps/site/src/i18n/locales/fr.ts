import type { Messages } from "./es";

// El francés, NEUTRO y de « vous » (SITIO-WEB-CONTENIDO.md §8).
//
// La puntuación francesa lleva espacio antes de `? ! : ;` y dentro de « ». Ese
// espacio es de NO separación —`\u202f` (fino) o `\u00a0`—, escrito con su
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
    // «Commencer gratuitement» no cabe en el menú de un celular (verificado a
    // 390 y a 320 px): ahí el botón dice solo esto.
    ctaShort: "Commencer",
    openMenu: "Ouvrir le menu",
    closeMenu: "Fermer le menu",
  },
  hero: {
    headline: ["Vos ventes.", "Un point, c'est tout"],
    lead: "Point de vente, stocks et achats au même endroit. Scannez, encaissez et gardez le contrôle de votre commerce, à la caisse ou sur votre téléphone.",
    primaryCta: "Commencer gratuitement",
    secondaryCta: "Découvrir les fonctions",
    trustLine: "14 jours avec toutes les fonctionnalités. Sans carte bancaire. Rien à installer.",
    mock: {
      label: "Exemple d'une vente dans SellPointy",
      badge: "Scanné\u202f!",
      title: "Vente en cours",
      register: "Caisse 1",
      total: "Total",
      pay: "Encaisser",
      items: {
        first: { name: "Eau de source 1 L", detail: "Qté 2" },
        second: { name: "Biscuits à l'avoine 170 g", detail: "Qté 1" },
        third: { name: "Huile d'olive 500 mL", detail: "Qté 1" },
      },
    },
  },
  planTags: {
    fromPro: "Dès Pro",
    onPlus: "Avec Plus",
  },
  whatItDoes: {
    eyebrow: "Ce qu'il fait",
    title: "Tout ce qui se passe à votre comptoir, sur un seul écran.",
    sub: "Fini les allers-retours entre le cahier, le tableur et la calculatrice. SellPointy relie ce que vous vendez, ce que vous avez et ce que vous achetez.",
    items: {
      sell: {
        title: "Vendez",
        text: "Encaissez avec un lecteur de codes-barres, un lecteur Bluetooth ou l'appareil photo de votre téléphone. Des reçus à votre logo et des sessions de caisse avec comptage, pour terminer la journée sans surprise.",
      },
      track: {
        title: "Contrôlez",
        text: "Entrées, sorties, transferts et inventaires physiques. L'historique de chaque produit, dans tous vos entrepôts.",
      },
      buy: {
        title: "Achetez",
        text: "Enregistrez vos achats avec leur facture et gardez vos coûts à jour, pour que votre prix de vente laisse la marge que vous attendez.",
      },
      decide: {
        title: "Décidez",
        text: "Des rapports de ventes et de dépenses, prêts à lire et à exporter. Rien à préparer à la main.",
      },
    },
  },
  benefits: {
    eyebrow: "Avantages pour votre commerce",
    title: "Moins de temps dans le système. Plus de temps pour vendre.",
    items: {
      fast: {
        title: "Encaissez en *quelques secondes*.",
        text: "Vous scannez, et le produit est déjà sur le reçu. Personne n'attend pendant que vous cherchez un prix.",
      },
      catalog: {
        title: "Créez votre catalogue en *un après-midi*.",
        text: "Scannez le code-barres\u00a0: SellPointy reconnaît le produit et propose son nom, il ne vous reste qu'à fixer le prix. Vos produits sont déjà dans Excel\u202f? Importez-les en une seule fois.",
      },
      shift: {
        title: "Fermez la caisse *sans surprise*.",
        text: "Chaque session s'ouvre et se ferme avec son comptage. Vous savez qui a encaissé quoi, combien, et si le compte est juste.",
      },
      stock: {
        title: "Sachez *ce que vous avez*, sans compter à la main.",
        text: "Chaque vente sort du stock et chaque achat le réapprovisionne. Votre inventaire est un chiffre, pas une impression.",
      },
      expiry: {
        title: "Que rien ne *périme* sur vos étagères.",
        text: "Des lots avec leur date et une alerte claire sur ce qui arrive à échéance, pour le vendre à temps plutôt que de le jeter.",
      },
      pocket: {
        title: "Tout votre commerce, *dans votre poche*.",
        text: "Ordinateur, tablette ou téléphone. Connectez-vous de n'importe où et voyez exactement ce que voit la caisse.",
      },
    },
  },
  whoFor: {
    eyebrow: "Pour qui",
    title: "Conçu pour le commerce que vous tenez vous-même.",
    trades: [
      "Commerces de proximité",
      "Épiceries",
      "Quincailleries",
      "Magasins de produits naturels",
      "Boutiques de cadeaux",
      "Boutiques de vêtements",
      "Animaleries",
      "Boulangeries",
      "Confiseries",
    ],
    // No se muestra en Canadá (`CLINICS_MARKETS`).
    clinics: "Cabinets médicaux",
  },
  faq: {
    eyebrow: "Questions",
    title: "Ce que tout le monde demande avant de commencer.",
    items: {
      install: {
        q: "Dois-je installer quelque chose\u202f?",
        a: "Non. SellPointy fonctionne dans le navigateur de votre ordinateur, de votre tablette ou de votre téléphone. Vous vous connectez avec votre courriel, et c'est tout.",
      },
      scanner: {
        q: "De quel lecteur de codes-barres ai-je besoin\u202f?",
        a: "N'importe lequel\u00a0: les lecteurs USB et Bluetooth fonctionnent dès qu'ils sont branchés. Et si vous n'en avez pas, l'appareil photo de votre téléphone ou de votre tablette fait aussi l'affaire.",
      },
      spreadsheet: {
        q: "Puis-je importer les produits que j'ai déjà dans Excel\u202f?",
        a: "Oui. Téléchargez le modèle, collez vos produits et importez-les en une seule fois. Ceux qui ont un code-barres peuvent aussi être ajoutés en les scannant.",
      },
      trialEnd: {
        q: "Que se passe-t-il à la fin des 14 jours\u202f?",
        a: "Vous choisissez le forfait qui vous convient. Si vous n'avez pas encore décidé, vos données ne sont pas supprimées\u00a0: elles vous attendent.",
      },
      payment: {
        q: "Comment payer\u202f?",
        a: "Par virement bancaire, au mois ou à l'année. En payant l'année complète, vous payez 10 mois et en utilisez 12.",
      },
      changePlan: {
        q: "Puis-je changer de forfait plus tard\u202f?",
        a: "Oui. Écrivez-nous depuis l'écran «\u00a0Mon forfait\u00a0» de votre compte, indiquez le forfait souhaité, et nous l'activons.",
      },
      data: {
        q: "Mes données m'appartiennent-elles\u202f?",
        a: "Oui. Vos ventes, vos prix, vos clients et vos stocks n'appartiennent qu'à vous\u00a0: ils ne sont ni partagés ni vendus. Le seul élément commun est le catalogue de codes-barres — le nom imprimé sur l'emballage —, qui vous permet d'ajouter un produit simplement en le scannant.",
      },
      // La línea de honestidad (§8.4): el día que el francés entre a la
      // aplicación, la última frase se quita.
      languages: {
        q: "Dans quelles langues est-il offert\u202f?",
        a: "En anglais et en espagnol. Chaque membre de votre équipe choisit la sienne. Le français sera bientôt disponible.",
      },
      // Las dos de Estados Unidos no tienen hoy versión en francés; existen
      // para que los tres idiomas tengan las mismas claves.
      staffLanguage: {
        q: "Mon équipe peut-elle l'utiliser en espagnol\u202f?",
        a: "Oui. Chaque personne choisit sa langue, l'anglais ou l'espagnol, sur le même compte.",
      },
      salesTax: {
        q: "Les taxes de vente sont-elles déjà configurées\u202f?",
        a: "À la création de votre compte, SellPointy applique le taux de base de votre État. Si votre ville ou votre comté ajoute le sien, vous l'ajustez une fois, et c'est réglé.",
      },
      canadaTax: {
        q: "Les taxes sont-elles déjà configurées\u202f?",
        a: "À la création de votre compte, SellPointy configure les taxes de votre province\u00a0: TPS et TVQ au Québec, TVH ou TVP ailleurs. Vous pouvez les modifier à tout moment.",
      },
    },
  },
  closing: {
    title: "Mettez fin au désordre.",
    text: "Créez votre compte, scannez vos premiers produits et réalisez votre première vente dès aujourd'hui. Vous préférez en parler d'abord\u202f? Écrivez-nous.",
    primaryCta: "Commencer gratuitement",
    secondaryCta: "Nous écrire",
  },
  footer: {
    tagline: "Vos ventes. Un point, c'est tout.",
    navLabel: "Pied de page",
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
        mx: "Vous êtes au Mexique\u202f?",
        us: "Vous êtes aux États-Unis\u202f?",
        ca: "Vous êtes au Canada\u202f?",
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
