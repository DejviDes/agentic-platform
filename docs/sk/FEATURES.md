# Funkcie Agentic Platform

[English](../FEATURES.md) · **Slovenčina**

Katalóg všetkého, čo Mesto vie. AI pri nastavení odtiaľto vysvetľuje, čo človek zapína (`docs/sk/SETUP.md`). Stav: **hotové** = v balíku a funguje, **v príprave** = zatiaľ nie je v balíku.

## Mesto

| Funkcia | Čo robí | Variant | Stav | Požiadavky, nastavenie |
|---|---|---|---|---|
| **Mesto z priečinkov** | Budova = priečinok so skupinou projektov, poschodie = projekt. Mesto sa poskladá samo zo skutočných priečinkov a sessions Claude Code. | Základ | hotové | `buildings` vo `world.json` |
| **Archív** | Projekt bez aktivity N dní sa presunie do prístavby „archív“, pri prvej práci sa vráti do veže. | Základ | hotové | `archive`, `archiveAfterDays` |
| **Scéna Vrstvy** | Pokojné mesto z dosiek, kancelária ako malé mesto tímu, rýchle. | Základ | hotové | `"city": "layers"` |
| **Pôvodné mesto** | Sklenené veže s oknami, interiéry, postavičky agentov. | Základ | hotové | `"city": "classic"` |
| **Stav na budove** | Poschodie, kde agent pracuje, jemne pulzuje; kde čaká na tvoje schválenie, má výrazný pás vo farbe budovy. Počítadlo „čaká na teba“ v hornej lište. | Základ | hotové | |
| **Mozog** | Budova v strede mesta: tvoj priečinok s poznámkami (Obsidian alebo obyčajný markdown). Agenti doň navrhujú zápisy rozhodnutí a poznatkov. | Plné (dá sa aj v Základe) | hotové | `brain` |
| **Jazyk** | Rozhranie, texty servera a pokyny pre agentov po anglicky alebo po slovensky. | Základ | hotové | `"language": "en"` alebo `"sk"`, aj v Nastaveniach |

## Agenti a práca

| Funkcia | Čo robí | Stav | Poznámka |
|---|---|---|---|
| **Kancelária poschodia** | Na každom poschodí vedúci a tím zamestnancov (`.claude/agents/*.md` v projekte). | hotové | |
| **Chat s agentom** | Skutočný Claude Code agent v priečinku projektu (Claude Agent SDK, tvoje predplatné). Prílohy a obrázky, náhľad súborov z odpovede, interaktívne vizuály v správe. | hotové | |
| **Schvaľovanie kartami** | Zápis, príkaz alebo iný krok agenta schváliš kliknutím (Povoliť / Zamietnuť). | hotové | |
| **Režimy oprávnení** | Pýtať sa, Úpravy bez pýtania, Najprv plán, Auto. Prepínajú sa pri poli na písanie. | hotové | poistky platia vo všetkých |
| **Model a effort** | Predvolené v `agents`, každé poschodie a konverzácia si ich môže zmeniť. | hotové | |
| **Nábor tímu** | Vedúci prejde projekt a navrhne zamestnancov kartou, po kliknutí Prijať sa zapíšu do `.claude/agents/`. | hotové | |
| **Delegovanie** | Vedúci posiela úlohy zamestnancom, model a effort potvrdíš kartou. | hotové | |
| **Pamäť projektu** | Agent navrhne pravidlo do `CLAUDE.md` projektu alebo zápis do poznámok, zapíše sa po kliknutí. | hotové | |
| **Plán práce** | Pri dlhšej úlohe agent ukáže zoznam krokov a odškrtáva ich. | hotové | |
| **Router úloh** | Pole „Čo treba spraviť?“: napíšeš úlohu a Mesto navrhne, na ktoré poschodie a ku komu patrí. | hotové | rýchly malý model |
| **Dispečing** | Napíšeš voľný text s viacerými úlohami, Mesto ho rozdelí, ku každej navrhne poschodie a agenta a spustíš ich naraz alebo neskôr. | hotové | |
| **Pracovňa** | Všetky konverzácie mesta na jednej obrazovke bez 3D (kláves W). | hotové | |
| **Hľadanie** | ⌘K: poschodia, konverzácie, agenti. | hotové | |
| **Pokračovanie v termináli** | Skopíruje príkaz `claude --resume` pre otvorenú konverzáciu. | hotové | |

## Riadiaca centrála

| Funkcia | Čo robí | Stav | Poznámka |
|---|---|---|---|
| **Poschodie appky** | Agent centrály upravuje samotné Mesto (vzhľad, funkcie) na požiadanie. | hotové | `"controlCenter": true`, appka v gite |
| **Lišta zmien** | Zmenené súbory, diff, commit a push kliknutím. | hotové | push iba tvojím kliknutím |
| **Reštart servera** | Po zmene servera ho agent reštartuje (`mcp__agentic__restart_server`) až po tvojom schválení a po úspešnej skúške. | hotové | naozajstný reštart iba so službou (macOS) |

## Poistky (platia vždy, aj v režime Auto)

- Agent nezapisuje `CLAUDE.md` ani `.claude/agents/` sám, iba navrhuje kartou.
- Agent nemaže natrvalo, presúva do koša.
- Žiadny push na servery v `guards.bannedPush` a žiadny push ani commit cez API mimo tvojho kliknutia.
- Agent nečíta ani nezapisuje `data/` servera (sessions, povolenia) a citlivé súbory (`.env`, kľúče).
- Server počúva iba na `127.0.0.1` (nie je dostupný zo siete) a beží na predplatnom, nikdy cez API kľúč.

## Pohodlie

| Funkcia | Čo robí | Systém | Stav |
|---|---|---|---|
| **Nastavenia** (⌘,) | Vzhľad, mesto, chat, upozornenia, spotreba, poschodia, naplánované úlohy. | všetky | hotové |
| **Väčšie písmo** | Celé rozhranie o stupeň väčšie. | všetky | hotové |
| **Upozornenia** | Zvuk a notifikácia, keď agent čaká alebo skončí; tichý režim a „ticho do“. | všetky (v okne), macOS (aj bez okna) | hotové |
| **Spotreba** | Odhad spotreby pri správe a limity predplatného (5 h, týždeň); Úroveň šetrenia (vysoká, stredná, nízka). | všetky | hotové |
| **Diktovanie** | Mikrofón v poli správy, prepis lokálne cez Whisper (mlx). | macOS s čipom Apple | hotové, voliteľné |
| **Zámok** | Zamknúť Mesto, odomknutie cez Touch ID alebo heslo k Macu. | macOS | hotové, voliteľné |
| **Služba na pozadí** | Server sa spustí po prihlásení a po páde znova. | macOS (launchd); Linux a Windows podľa sprievodcu | hotové, voliteľné |
| **Nahlásiť chybu** (U) | Zapíše hlásenie s kontextom pre centrálu. | všetky | hotové |

## Moduly (v príprave)

| Modul | Čo bude robiť | Variant | Stav |
|---|---|---|---|
| **Domov** | Štvrť pred mestom: osobný prehľad dňa, úlohy (markdown alebo Notion), kalendár (súbor `.ics`), návyky, triedenie nových poznámok, plánovaní agenti (ranný prehľad, večerné zhrnutie). Prispôsobí sa tomu, či máš Mozog a aký. | Plné | v príprave |
| **Pošta** | Prehľad dôležitej pošty, akcie Otvoriť / Vybavené / Úloha. | Plné | v príprave |
| **Mobil** | Mesto v mobile v domácej sieti: párovanie, Face ID, push notifikácie, appka na plochu (PWA). | Plné | v príprave |

## Klávesové skratky

V meste: klik na poschodie = vstup, **G** = Mozog, **P** = panel, **W** = Pracovňa, **⌘K** = hľadať, **U** = nahlásiť chybu, **Esc** = späť, **?** = riadok skratiek. V kancelárii: **Enter** = poslať, **⌘↵** = poslať hneď.
