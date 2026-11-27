# Ako používať Agentic Platform

[English](../USAGE.md) · **Slovenčina**

## Mesto

- **Otáčanie a priblíženie:** ťahaj myšou, kolieskom približuj. Prejdenie nad poschodím ukáže jeho názov a posledné konverzácie.
- **Budovy** sú tvoje skupiny projektov, **poschodia** jednotlivé projekty. Poschodie, kde agent práve pracuje, jemne pulzuje. Keď agent čaká na tvoje schválenie, poschodie má výrazný pás a v hornej lište svieti „čaká na teba“.
- **Mozog** (ak ho máš) je budova v strede, kláves **G**.
- **Archív:** projekty bez aktivity sú v nízkej prístavbe vedľa budovy. Keď v nich začneš pracovať, vrátia sa do veže.

## Kancelária a chat

1. **Klik na poschodie** otvorí kanceláriu: vedúci v strede, okolo neho zamestnanci.
2. Napíš vedúcemu, čo treba. Agent pracuje priamo v priečinku projektu ako Claude Code.
3. **Schvaľovanie:** keď chce agent niečo zapísať alebo spustiť, ukáže kartu s presným krokom. Povoliť / Zamietnuť. Ak chceš menej klikania, prepni režim pri poli na písanie:
   - **Pýtať sa**: schvaľuješ všetko okrem čítania,
   - **Úpravy bez pýtania**: zápisy súborov bez pýtania, príkazy sa pýtajú,
   - **Najprv plán**: agent najprv navrhne plán a nič nemení,
   - **Auto**: agent pracuje sám, poistky platia stále.
4. **Model a effort** zmeníš tiež pri poli na písanie. Vyšší effort = dôkladnejšie, ale viac míňa z limitu.
5. **Enter** pošle správu, **⌘↵** pošle hneď aj počas práce agenta.

## Tím

- Povedz vedúcemu **„navrhni mi tím“**. Prejde projekt a kartou navrhne zamestnancov (meno, rola, čo robí). Klikneš Prijať, Upraviť alebo Nie.
- Zamestnanci sú obyčajné súbory `.claude/agents/<meno>.md` v projekte, fungujú aj v samotnom Claude Code.
- Vedúci im posiela úlohy sám (delegovanie), model a effort potvrdíš kartou. So zamestnancom môžeš písať aj priamo (klik na neho v kancelárii).

## Pamäť a poznámky

- Keď padne rozhodnutie, agent navrhne zápis kartou: **pravidlo** do `CLAUDE.md` projektu (ako v projekte pracovať) alebo **poznámku** do Mozgu či do priečinka projektu. Nič sa nezapíše bez tvojho kliknutia.

## Keď nevieš, kam s úlohou

- **„Čo treba spraviť?“** v prehľade mesta: napíš úlohu, Mesto navrhne poschodie a agenta.
- **Dispečing:** napíš viac úloh naraz, Mesto ich rozdelí a ku každej navrhne tím. Spustíš ich naraz alebo si ich pripravíš na neskôr.

## Pracovňa (W)

Všetky konverzácie mesta na jednej obrazovke bez 3D: vľavo zoznam (čo čaká na teba, čo beží, nedávne), v strede chat. Hodí sa na dlhšiu prácu.

## Riadiaca centrála

Poschodie samotnej appky. Povedz jej agentovi, čo chceš v Meste zmeniť (napr. „pridaj budovu pre klientov“, „zmeň farbu Projektov“, „chcem tmavšie pozadie“). Zmeny vidíš v lište centrály, commit a push spustíš kliknutím. Keď sa mení server, agent ho po tvojom schválení reštartuje.

## Nastavenia (⌘,)

Vzhľad (Vrstvy alebo Pôvodné mesto, väčšie písmo, jazyk), upozornenia (zvuk, tichý režim, ticho do), spotreba a úroveň šetrenia, správa poschodí (premenovať, skryť, presunúť), naplánované úlohy. Zmenu budov a poznámok urobíš vetou „zmeň nastavenie Mesta“ v Riadiacej centrále alebo v priečinku appky.

## Šetrenie limitu predplatného

- Bežnú prácu rob s effortom `medium`, ťažké veci `high`.
- Malé úlohy daj lacnejšiemu modelu (Sonnet, Haiku).
- Dlhú konverzáciu radšej ukonči a začni novú. Odhad spotreby vidíš pri každej správe, limity v hornej lište.

## Klávesy

V meste: **G** Mozog, **P** panel, **W** Pracovňa, **⌘K** hľadať, **U** nahlásiť chybu, **Esc** späť, **?** riadok skratiek, **⌘,** Nastavenia.
