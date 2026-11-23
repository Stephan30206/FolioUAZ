import modele from "./style-model.json" with {type:"json"};
import {features, samples} from "./style-features.mjs";

export function indiceRedaction(texte, langue, partiel) {
  if (!langue) return {status:"off"};
  if (!Object.hasOwn(modele.models,langue)) return {status:"indisponible",message:"Nous ne disposons pas de modèle de rédaction évalué en malgache pour cette expérience."};
  if (partiel) return {status:"indisponible",message:"La lecture du document est incomplète. Le calcul de l’indice de rédaction exige une version entièrement lisible."};
  const extraits=samples(texte);
  if (!extraits.length) return {status:"indisponible",message:"Il faut au moins 100 mots de texte après les exclusions pour examiner le style."};
  const modeleLangue=modele.models[langue];
  const passages=extraits.map(({text,words,start,end})=>{
    const valeurs=features(text,langue);
    const niveau=valeurs.reduce((s,v,i)=>s+v*modeleLangue.weights[i],modeleLangue.bias);
    return {start,end,mots:words,signale:niveau>modeleLangue.threshold,apercu:text.replace(/\s+/gu," ").slice(0,160)};
  });
  return {status:"calcule",langue,passages,test:modeleLangue.test,modele:"HC3 Multi · régression logistique · v1"};
}
