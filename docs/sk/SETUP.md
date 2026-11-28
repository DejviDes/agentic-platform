# Nastavenie Agentic Platform (postup pre AI)

[English](../SETUP.md) · **Slovenčina**

Tento súbor je pre AI asistenta (Claude Code alebo inú AI v tomto priečinku), ktorý používateľa prevádza nastavením. Človek si ho môže prečítať tiež, ale bežne iba povie „nastav platformu“ (alebo „nastav mi Mesto“). Anglický originál je `docs/SETUP.md`; pri rozdiele platí ten.

## Ako viesť rozhovor

- **Jedna téma naraz.** Pri každej vlastnosti povedz v jednej až dvoch vetách, čo robí a čo z toho človek má, navrhni odporúčanú voľbu a opýtaj sa. Nevysypávaj na neho všetky otázky naraz.
- **Hovor jeho jazykom.** Kto píše po slovensky, dostane odpovede po slovensky (tykaj) a vo `world.json` nastav `"language": "sk"` (rozhranie a pokyny pre agentov budú po slovensky). Pri inom jazyku odpovedaj v ňom a povedz, že rozhranie je po anglicky alebo po slovensky.
- **Nič nespúšťaj potichu.** Pred každým príkazom krátko povedz, čo robí. Nič mimo priečinka appky nemeň bez súhlasu (výnimka: súbor služby v kroku 10, aj to až po súhlase).
- **Nikdy API kľúč.** Mesto beží na predplatnom Claude cez prihlásené Claude Code CLI (`claude auth login`). Ak je nastavená `ANTHROPIC_API_KEY`, povedz, že ju Mesto pred spustením agentov maže.
- **Nič nevymýšľaj.** Cesty ber z výstupu `setup/verify.mjs` alebo od človeka. Ak niečo nevieš, opýtaj sa.
- **Všetko sa dá zmeniť neskôr.** Pri neistote zvoľ jednoduchšiu možnosť a povedz, že ju zmení vetou „zmeň nastavenie Mesta“.
- Odpovede si zbieraj a `world.json` zapíš **až na konci** po zhrnutí a súhlase (krok 11).

Katalóg všetkých vlastností s popisom je v `docs/sk/FEATURES.md`. Keď sa človek pýta „čo to je?“, odpovedaj z neho.

## 0. Zisti, kde sme

```bash
node setup/verify.mjs --json
```

- `app.worldJson: true` → Mesto už je nastavené. Ukáž mu súčasné nastavenie (`app.buildings`, `app.brain`, `app.modules`) a opýtaj sa, čo chce zmeniť. Prejdi iba príslušné kroky a na konci urob krok 11 (iba zmenené časti).
- Inak ideš celým postupom. Človeka pozdrav a v dvoch vetách povedz, čo ho čaká: „Prejdeme spolu asi 10 krátkych otázok (5 až 10 minút). Na konci ti Mesto spustím a ukážem, ako sa ovláda.“

## 1. Požiadavky

| Kontrola | Ak chýba |
|---|---|
| `node.ok` (Node 22+) | macOS: `brew install node` alebo `nvm install 22`. Linux: nvm. Windows: inštalátor z nodejs.org. |
| `claude.installed` | Inštalácia Claude Code podľa oficiálnej dokumentácie (docs.claude.com, Claude Code). |
| `claude.loggedIn` | Človek spustí v termináli `claude auth login` a prihlási sa svojím predplatným (Pro alebo Max). Ty to za neho nerob, potrebuje prehliadač. |
| `git.installed` | Odporuč nainštalovať (Riadiaca centrála, história zmien a aktualizácie ho potrebujú). |
| `app.packagesInstalled` | Spustíš v kroku 11 (`npm install`). |
| `port.free` | Port 4747 je obsadený (beží už Mesto alebo iný server). V kroku 11 použi iný port (`PORT=5050 npm start`). |

Systém: Mesto beží na macOS, Linuxe aj Windowse (server je Node). macOS je otestovaný; na Linuxe a Windowse sa veci iba pre Mac (Touch ID, notifikácie systému, spánok Macu, diktovanie) vypnú, postup je v časti „Linux a Windows“ za krokom 10.

## 2. Variant

Opýtaj sa, ktorý variant chce. Variant je iba predvoľba, moduly sa dajú kedykoľvek zapnúť alebo vypnúť.

| Variant | Čo obsahuje | Pre koho |
|---|---|---|
| **Základ** | 3D mesto z tvojich projektov: budovy, poschodia, na každom poschodí vedúci a tím agentov, chat, schvaľovanie, Pracovňa, Riadiaca centrála | kto chce mať prehľad o projektoch a agentoch |
| **Plné** | Základ + Mozog (tvoje poznámky, napr. Obsidian) + štvrť Domov (osobný prehľad dňa, úlohy, kalendár, návyky, plánovaní agenti) + Mesto v mobile | kto chce z Mesta aj osobný „life hub“ |

Pozor: moduly Domov, Pošta a Mobil sú zatiaľ v príprave (pozri `docs/sk/FEATURES.md`, stĺpec Stav). Ak si človek vyberie Plné, povedz mu to a nastav zatiaľ Základ + Mozog, moduly prídu neskôr.

## 3. O tebe

1. **Meno**: ako ho majú agenti a karty oslovovať (`user.name`). Meno sa nikam neposiela, ostáva vo `world.json`.
2. **Mesto, kde žije** (nepovinné): iba na presný východ a západ slnka vo farbách dňa. Zapíš približné súradnice `location: { "lat": …, "lon": … }` (na dve desatinné miesta stačí). Bez nich sa poloha odhadne z časového pásma.
3. **Jazyk**: `"language": "sk"` pre slovenčinu, inak `"en"` (predvolené). Prepína sa aj v Nastaveniach › Vzhľad.

## 4. Budovy (projekty)

Mesto sa skladá zo skutočných priečinkov: **budova = priečinok so skupinou projektov, poschodie = jeden projekt (podpriečinok)**. Aktivitu poschodí Mesto ráta zo sessions Claude Code.

1. Ukáž mu `candidates` z kontroly (cesta, počet priečinkov, koľko je v gite a koľko má `CLAUDE.md`) a opýtaj sa, ktoré skupiny chce ako budovy. Najviac 5 budov.
2. Pre každú budovu: kľúč (malé písmená bez medzier), `title`, `color` (ponúkni z palety `#14a3b8` tyrkysová, `#8a6cff` fialová, `#4f7cff` modrá, `#2bb68a` zelená, `#e0739a` ružová, `#f2a65a` oranžová), `root`, priečinky na vynechanie (`exclude`).
3. **Archív:** projekt bez aktivity 30 dní ide do prístavby „archív“ a vráti sa pri prvej práci (`archive: true`, dĺžka `archiveAfterDays` na najvyššej úrovni). Pri budove, kde to nechce (napr. predmety v semestri), `archive: false`.
4. **Iba projekty s `CLAUDE.md`** (`onlyWithClaudeMd: true`): vhodné, keď má v priečinku aj veci, ktoré nie sú projekty.
5. **Budova na štúdium** (voliteľné, ponúkni študentom): poschodie = predmet, poznámky predmetu sú v jednom priečinku (`root`) a kód úloh v inom (`code`, priečinky `<KÓD>` alebo `<KÓD>-…`), `subjectCode: true`. Sessions z oboch sa rátajú k predmetu.
6. Jednotlivé projekty sa dajú premenovať, skryť, zoradiť alebo presunúť do inej budovy vo `floors` (vzor vo `setup/world.example.json`). To sa robí aj neskôr priamo v appke (Nastavenia › Poschodia).

Ak nevie, začni s jednou budovou nad priečinkom s projektmi.

## 5. Mozog a poznámky

Mozog je budova v strede mesta: priečinok s poznámkami (second brain), kam agenti navrhujú zápisy rozhodnutí a poznatkov. Zápis sa vždy robí až po kliknutí na kartu.

Opýtaj sa: **„Máš svoje poznámky? Kde?“** a podľa odpovede:

| Odpoveď | Čo nastaviť |
|---|---|
| **Obsidian** | Ponúkni trezory z kontroly (`obsidian`: z nastavení Obsidianu a priečinky s podpriečinkom `.obsidian` na bežných miestach). Keď je zoznam prázdny, opýtaj sa používateľa na cestu k trezoru; trezor je každý priečinok s podpriečinkom `.obsidian`. `brain: { "title": "Mozog", "path": "<trezor>", "kind": "obsidian" }`. Agenti píšu markdown s odkazmi `[[…]]`. |
| **Priečinok s markdown súbormi** (Logseq, iA Writer, Bear export, VS Code…) | `brain: { "title": "Mozog", "path": "<priečinok>", "kind": "folder" }`. |
| **Notion, Apple Poznámky, OneNote alebo iná appka v cloude** | Mesto ich lokálne nečíta. Ponúkni dve možnosti: bez Mozgu (`brain` vynechaj, poznámky ostanú v priečinkoch projektov), alebo založiť jednoduchý priečinok `~/Poznamky` ako nový Mozog. Notion sa dá agentom pripojiť cez Notion MCP, to je mimo nastavenia Mesta. |
| **Nemám** | Navrhni bez Mozgu. Poznámky a rozhodnutia potom agenti navrhujú do priečinka projektu (`"notes": "folder"` pri každej budove). Ak chce, založ `~/Poznamky`. |

Voliteľné kľúče Mozgu: `private` (priečinky na najvyššej úrovni, ktoré appka ukáže bez mien) a `omitOrphaned` (priečinky, ktoré sa vynechajú pri hľadaní poznámok bez odkazov), vzor vo `setup/world.example.json`.

**Pravidlá Mozgu:** ak trezor má `CLAUDE.md`, agenti sa ním riadia (kam písať, čo nikdy nemeniť). Ak ho nemá, ponúkni krátky `CLAUDE.md` do trezoru s 3 pravidlami: nové poznámky do priečinka `Inbox/`, existujúce iba dopĺňať, nič nemazať. Zapíš ho iba so súhlasom.

**Kam idú poznámky projektov** (rozhodnutia, stav, TODO, ktoré agent navrhne kartou): opýtaj sa pri každej budove a zapíš ako `notes` budovy:

| Voľba | `notes` |
|---|---|
| do Mozgu, jeden súbor na projekt | `"~/Poznamky/Projekty/{slug}.md"` (`{slug}` = názov priečinka malými písmenami s pomlčkami, `{name}` = presný názov priečinka) |
| do Mozgu, priečinok na projekt | `"~/Poznamky/Projekty/{name}/"` (súbor si agent vyberie podľa `CLAUDE.md` priečinka) |
| do priečinka projektu, nikdy do Mozgu | `"folder"` |
| poznámky v samotnom poschodí (budova na štúdium, kde poschodie je priečinok s poznámkami) | `"{path}/"` |

Pri pracovných a klientskych projektoch odporuč `"folder"`, nech sa firemné veci nemiešajú s osobnými poznámkami. Bez `notes` agent zápis nenavrhuje, rozhodnutia iba napíše do odpovede.

## 6. Agenti

Predvolený model a effort agentov (`agents`). Odporúčanie: `claude-opus-5-5` a `medium`. Lacnejšie (`claude-sonnet-5-5`, effort `low`) šetrí limit predplatného. Každé poschodie a každá konverzácia si to môže zmeniť v appke.

Vysvetli jednou vetou, ako tím vzniká: na každom poschodí je vedúci; keď ho poprosí „navrhni mi tím“, vedúci prejde projekt a navrhne zamestnancov kartou, po kliknutí Prijať sa zapíšu do `.claude/agents/` v projekte.

## 7. Vzhľad mesta

| Scéna | Popis |
|---|---|
| **Vrstvy** (odporúčané) | Pokojné mesto z dosiek, rýchle aj na slabšom počítači. Poschodie = doska, kancelária ako malé mesto tímu. |
| **Pôvodné mesto** | Sklenené veže s oknami, interiéry, postavičky agentov. Viac detailov, náročnejšie na grafiku. |

`"city": "layers"` alebo `"classic"`. Prepína sa aj v appke (Nastavenia › Vzhľad).

## 8. Riadiaca centrála

Centrála je poschodie samotnej appky: jej agent vie upravovať Mesto (vzhľad, funkcie) na požiadanie a commit či push spustíš kliknutím. Predvolene zapnutá (`"controlCenter": true`). Potrebuje, aby bol priečinok appky v gite: ak `git.appInGit` je `false`, so súhlasom spusti `git init -b main && git add -A && git commit -m "Moje Mesto"`.

## 9. Poistky

Poistky platia vždy, aj v režime Auto. Vysvetli ich krátko (pozri `docs/sk/FEATURES.md`, sekcia Poistky) a opýtaj sa iba na jednu vec: **existujú git servery, kam agenti nikdy nesmú pushovať?** (firemný GitLab, školský server). Zapíš hostiteľov do `guards.bannedPush`.

## 10. Voliteľné doplnky

Ponúkaj po jednom, iba ak dávajú zmysel pre jeho systém.

| Doplnok | Systém | Čo treba |
|---|---|---|
| **Služba na pozadí** (server sa spustí po prihlásení a reštartuje sa sám) | macOS | `bash launchd/install.sh` (vyplní šablónu, službu nespúšťa, vypíše príkazy na zapnutie) |
| **Diktovanie** (mikrofón v poli správy, prepis lokálne cez Whisper na čipe Apple) | macOS s čipom Apple | `uv` a `ffmpeg`; model sa pri prvom použití stiahne (asi 1,5 GB) |
| **Kontrola appky** `npm run check` (iba ak bude Mesto upravovať) | všetky | `npx playwright install chromium` (asi 150 MB). Kontrola otvára appku v Chromiu, preto potrebuje **bežiaci server**: spusti ju až po kroku 11 (`npm start`), na inom porte `npm run check -- http://localhost:5050`. |
| **Domov, Pošta, Mobil** | | v príprave, `modules` nechaj `false` |

Na Linuxe a Windowse ponúkni službu podľa časti „Linux a Windows“ nižšie.

## Linux a Windows

Otestované a pripravené je macOS. Na Linuxe a Windowse server naštartuje a veci iba pre Mac sám vypne. `node setup/verify.mjs` hlási systém v `system` (`os`, `title`, `mac`, `linux`, `windows`, `wsl`) a pri Linuxe aj `linux.systemd` a `linux.service`, pri Windowse `windows.task`. Podľa toho vyber postup a človeku jednou vetou povedz, čo na jeho systéme nebude:

| Vec | Na Linuxe a Windowse |
|---|---|
| Zámok Mesta (Touch ID) | vypnutý. Appku chráni iba to, že server počúva na `127.0.0.1`. Na zdieľanom počítači to povedz výslovne. |
| Notifikácie systému | iba v okne appky (pípnutie a upozornenie v prehliadači), notifikácie systému nie sú |
| Spánok Macu | kategória Mac v Nastaveniach sa neukáže |
| Tlačidlo Terminál pri konverzácii, výber priečinka cez Finder | nejde; priečinok v Správe poschodí zadá cestou |
| Otvorenie súboru v systéme | Linux `xdg-open`, Windows `start` |
| Úloha v Claude appke (`mcp__agentic__run_in_claude_app`) | iba macOS |
| Reštart servera agentom (`mcp__agentic__restart_server`) | nejde, server reštartuje človek (príkazy nižšie) |

### Linux: služba systemd (používateľská)

1. Over `linux.systemd` (`systemctl --user` funguje). Ak nie (napr. WSL bez systemd), ostaň pri `npm start`.
2. Zisti cesty: `command -v node`, `command -v claude` a priečinok appky.
3. Zapíš `~/.config/systemd/user/agentic-platform.service` (cesty doplň skutočné, `PATH` musí obsahovať priečinky s `node` aj `claude`):

```ini
[Unit]
Description=Agentic Platform
After=network.target

[Service]
WorkingDirectory=/cesta/k/appke
ExecStart=/cesta/k/node server.js
Environment=PATH=/home/user/.local/bin:/cesta/k/node/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

4. Povedz človeku príkazy (sám ich spusti iba so súhlasom): `systemctl --user daemon-reload`, `systemctl --user enable --now agentic-platform`. Log: `journalctl --user -u agentic-platform -f`, reštart: `systemctl --user restart agentic-platform`. Aby bežala aj bez prihlásenia: `loginctl enable-linger $USER`.

### Windows

- Odporuč **WSL 2** (Ubuntu) a v ňom postup pre Linux: Claude Code aj poistky príkazov sú písané pre POSIX shell. Appku potom otvorí v prehliadači vo Windowse na `http://localhost:4747`.
- Natívne Windows: Node 22+, Claude Code pre Windows (potrebuje Git for Windows), `npm install`, `npm start` v priečinku appky. Je to menej otestované, povedz to.
- Spúšťanie po prihlásení (natívne): Plánovač úloh. Príkaz pre PowerShell ukáž človeku, nech ho spustí sám (cestu doplň):

```powershell
$a = New-ScheduledTaskAction -Execute "node.exe" -Argument "server.js" -WorkingDirectory "C:\cesta\k\appke"
$t = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "AgenticPlatform" -Action $a -Trigger $t -Description "Agentic Platform"
```

  Zastavenie: `Stop-ScheduledTask AgenticPlatform`, zrušenie: `Unregister-ScheduledTask AgenticPlatform`. Diktovanie (mlx-whisper) je iba na macOS.

## 11. Zhrnutie, zápis a spustenie

1. Ukáž zhrnutie v pár riadkoch (meno, jazyk, budovy s cestami, Mozog, scéna, centrála, poistky, doplnky) a opýtaj sa „Môžem to tak zapísať?“.
2. Zapíš `world.json` podľa `setup/world.example.json` (iba vyplnené kľúče, bez komentárov `_note`).
3. Over bez servera: `node server/build-world.js` vypíše budovy a poschodia. Ak je budova prázdna, oprav `root`.
4. `npm install` (ak ešte neprebehol).
5. Spustenie: so službou podľa kroku 10, inak `npm start` na pozadí (aby si mohol pokračovať v rozhovore) alebo nech si ho človek spustí vo vlastnom termináli. Iný port: `PORT=5050 npm start`.
6. Povedz mu, nech otvorí **http://localhost:4747**, alebo port, s ktorým server spustil (`PORT=5050 npm start` → **http://localhost:5050**).

## 12. Prvé kroky (krátka prehliadka)

Preveď ho týmto, každé jednou vetou, a odkáž na `docs/sk/USAGE.md`:

1. V meste vidí svoje budovy. Ťahaním otáča, kolieskom približuje, klik na poschodie otvorí kanceláriu.
2. V kancelárii napíše vedúcemu krátku úlohu. Agent pri zápise alebo príkaze požiada o schválenie kartou (Povoliť / Zamietnuť). Režim oprávnení, model a effort sú pri poli na písanie.
3. „Navrhni mi tím“ → karta s návrhom zamestnancov → Prijať.
4. Pole „Čo treba spraviť?“ v prehľade mesta navrhne, na ktoré poschodie úloha patrí.
5. Kláves **W** prepne na Pracovňu (všetky konverzácie mesta bez 3D), **⌘,** otvorí Nastavenia.

Na záver mu povedz, že nastavenie kedykoľvek zmení vetou „zmeň nastavenie Mesta“ (tu v priečinku appky alebo v Riadiacej centrále).

## Riešenie problémov

| Problém | Príčina a riešenie |
|---|---|
| `EADDRINUSE` pri `npm start` | Port 4747 už používa iný server (aj služba). `PORT=5050 npm start`, alebo zastav ten druhý. |
| Agent hlási 401 alebo „not logged in“ | `claude auth login` v termináli, potom `claude auth status`. |
| Mesto je prázdne | Chýba `world.json` alebo sú zlé cesty v `root`. `node server/build-world.js` vypíše budovy a varovania. Budova bez poschodí sa nepostaví. |
| Projekt chýba vo veži | Je v archíve, je skrytý, alebo má budova viac ako `maxFloors` poschodí. Pri poschodí vo `floors` nastav `"archive": false`. |
| `claude: command not found` v službe | Služba nemá PATH z terminálu. Skontroluj PATH v `scripts/start.sh` (`~/.local/bin`, Homebrew, node z nvm). |
| `npm run check` hlási, že server nebeží | Najprv spusti server. Iný port: `npm run check -- http://localhost:5050`. |
| Červená značka v hlavičke appky | Server neodpovedá. Pozri log (macOS `~/Library/Logs/agentic-platform.log`, Linux `journalctl --user -u agentic-platform`, inak terminál). |
| Linux: služba nenájde `claude` | `Environment=PATH=` v súbore služby nemá priečinok s `claude` (zvyčajne `~/.local/bin`). Oprav, `systemctl --user daemon-reload` a reštart. |
| Agent nemôže zapísať `CLAUDE.md` alebo `.claude/agents/` | Je to poistka. Agent ich navrhuje kartou, zapíšu sa po kliknutí. |
| Limit predplatného sa míňa rýchlo | Nižší model alebo effort, nová konverzácia namiesto veľmi dlhej. Appka ukazuje odhad spotreby, v Nastaveniach › Spotreba je úroveň šetrenia. |
