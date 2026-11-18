# Brevets du format H.264 (version Linux, Steam Deck)

Ce document recense les **risques** liés aux brevets du format vidéo H.264. Ces risques sont
distincts de la question des licences logicielles, traitée dans `THIRD-PARTY-LINUX.md`. Ce n'est
pas un avis juridique : la décision de publier revient au responsable d'iBox, éventuellement après
conseil d'un juriste.

## Ce qui est concerné

- La **version Linux** décode du H.264 pour Remote Play en invité : l'image envoyée par l'hôte
  Windows. Elle utilise :
  - en priorité le **décodeur matériel du Steam Deck**, par VA-API (pilote Mesa du système, pas
    livré par iBox) ;
  - à défaut, le **décodeur logiciel de FFmpeg** (LGPL), livré dans l'AppImage.
- La **version Windows** n'embarque aucun décodeur H.264 : elle utilise ceux de Windows (Media
  Foundation) et de son moteur web. Elle *encode* en H.264 côté hôte avec l'encodeur de Windows.

## Les risques

1. **Format breveté.** H.264 (AVC) est couvert par des brevets réunis dans un groupement de
   licences (géré par Via LA, anciennement MPEG LA). Distribuer un décodeur H.264 peut, selon le
   pays, exiger une licence de ces brevets, même pour un logiciel libre et gratuit. La licence
   LGPL de FFmpeg ne couvre **pas** les brevets. FFmpeg le rappelle lui-même (« legal » sur
   ffmpeg.org).
2. **Seuils et conditions.** Les conditions publiées du groupement AVC ont historiquement prévu
   une franchise annuelle de redevances pour un petit nombre d'unités distribuées. Les montants,
   seuils et conditions actuels **sont à vérifier** auprès de Via LA avant publication. Ils
   changent avec les contrats.
3. **Territoires.** Les brevets logiciels ne sont pas reconnus de la même façon partout (Europe,
   États-Unis, etc.). Le risque dépend des pays où l'AppImage est téléchargée.
4. **Échéance.** Les brevets essentiels du H.264 expirent progressivement (dépôts des années 2000
   pour 20 ans). La liste et les dates précises **sont à vérifier** (Via LA publie la liste des
   brevets du groupement).
5. **Décodage matériel.** Le décodeur matériel est celui du Steam Deck et de son pilote système.
   iBox n'en distribue aucun, ce qui réduit l'exposition. Le repli logiciel reste distribué.

## Pistes pour réduire le risque

- **Matériel d'abord** (déjà fait) : VA-API est prioritaire, et le décodeur FFmpeg ne sert que de
  repli. On peut aller plus loin et publier une AppImage **sans** décodeur logiciel. Remote Play
  ne fonctionnerait alors que si le décodage matériel est disponible.
- **OpenH264 de Cisco** : Cisco prend en charge les redevances pour son binaire, à condition qu'il
  soit téléchargé depuis les serveurs de Cisco par l'utilisateur, et non livré dans l'AppImage.
- **Formats sans redevance** : faire envoyer par l'hôte du VP9 ou de l'AV1 (formats ouverts) aux
  invités qui le demandent. C'est un chantier côté hôte Windows (encodeur) et côté invité.
- **Licence** : contacter Via LA pour connaître les conditions applicables à une distribution
  gratuite.

## État

Décision du 2026-11-18 : FFmpeg en LGPL seulement, liaison dynamique, VA-API en priorité avec
repli logiciel. **Rien n'est publié** tant que les essais et ces vérifications ne sont pas
validés.
