# Event Scraper AI

Rozšírenie pre Google Chrome, ktoré zjednodušuje získavanie údajov o podujatiach z webových stránok. Kombinuje čítanie štruktúrovaných dát s analýzou textu a obrázkov pomocou Google Gemini. Výsledky zobrazí v upraviteľnom formulári, odkiaľ ich možno uložiť a vložiť do kompatibilného webového formulára.

Súčasťou je aj sťahovanie obrázkov cez pravé tlačidlo myši s automatickým pomenovaním podľa uloženého podujatia.

## Čo rozšírenie dokáže

- Načítať jedno hlavné podujatie z otvorenej stránky.
- Získať viac podujatí zo stránky so zoznamom a vybrať konkrétne podujatie na úpravu.
- Rozpoznať názov, dátumy, miesto konania, ulicu, číslo a obec.
- Pri analýze jedného podujatia využiť aj informácie z obrázka alebo plagátu.
- Voliteľne doplniť chýbajúcu adresu cez Google Maps.
- Uložiť upravené údaje a vložiť ich klávesovou skratkou **Alt+X**.
- Stiahnuť obrázok a pokúsiť sa ho previesť do JPEG.

## Ako prebieha extrakcia

### 1. Načítanie stránky

Po otvorení rozšírenia sa automaticky spustí načítanie jedného podujatia z aktívnej karty. Rozšírenie zo stránky zozbiera nadpis, text, metadáta, adresu stránky a dostupné štruktúrované dáta vo formáte JSON-LD alebo microdata.

Pri čítaní sa snaží vynechať navigáciu, pätičky, cookie oznámenia a ďalší nesúvisiaci obsah. Vyhľadáva tiež vhodné obrázky, napríklad plagát podujatia alebo hlavný obrázok stránky.

### 2. Vyhodnotenie štruktúrovaných údajov

Najprv sa spracujú údaje typu `Event` a súvisiace typy zo schema.org. Hlavné podujatie sa vyberá podľa zhody s nadpisom, názvom a URL stránky alebo podľa jeho označenia v štruktúrovaných dátach.

Ak má rozpoznané hlavné podujatie názov, dátumy, miesto konania a obec, údaje sa použijú bez volania AI. Ak údaje nestačia, nasleduje analýza pomocou Gemini.

### 3. Analýza pomocou AI

Rozšírenie volá Google Gemini API. V súbore [config.js](config.js) je aktuálne nastavený identifikátor modelu `gemini-3.5-flash-lite`; model možno zmeniť cez položku `geminiModel`. Použitý model musí byť dostupný pre váš API kľúč a podporovať požiadavky odosielané rozšírením.

AI dostáva text a kontext stránky spolu s už rozpoznanými údajmi. Pri spracovaní jedného podujatia sa rozšírenie pokúsi pripojiť aj jeden vhodný obrázok. Takto môže model čítať informácie, ktoré sú uvedené iba na plagáte, napríklad dátum alebo miesto konania. Ak sa obrázok nepodarí načítať, analýza pokračuje s textom.

Model má vrátiť údaje v JSON formáte podľa určenej schémy. Pokyny uprednostňujú informácie zo zdroja a pri nejasných údajoch vyžadujú prázdnu hodnotu. Rozšírenie následne kontroluje formát odpovede, normalizuje dátumy a spracuje adresu. Výsledok možno pred uložením ručne opraviť.

Ak AI zlyhá, rozšírenie sa pokúsi zobraziť dostupné štruktúrované údaje a upozorní na neúplný výsledok.

### Obrázky a PDF

Analýza obrázkov je súčasťou AI spracovania jednotlivého podujatia. Obrázok sa načíta zo stránky a odošle modelu; veľké obrázky sa pred odoslaním zmenšujú. Rozšírenie nevytvára snímku celej obrazovky.

**Priama analýza PDF dokumentov zatiaľ nie je implementovaná.** Aktuálny kód PDF nenačítava ani neposiela do Gemini. Samotný odkaz na PDF preto nestačí na extrakciu jeho obsahu. Ak je obsah dokumentu zverejnený aj ako bežný text alebo obrázok na webovej stránke, rozšírenie môže spracovať túto podobu obsahu.

### Zoznam podujatí

Tlačidlo **Načítať všetky zo zoznamu** spracuje obsah aktuálnej stránky ako zoznam podujatí. V tomto režime sa AI odosiela text a štruktúrované dáta bez obrázkov. Rozšírenie neprechádza automaticky odkazy na detaily ani ďalšie stránky zoznamu.

Výsledky sa zbavia duplicít a podujatí, ktorých rozpoznaný dátum konca už uplynul. Podujatie si potom vyberiete z rozbaľovacieho zoznamu a upravíte jeho údaje.

### Doplnenie adresy a pamäť výsledkov

Ak je nastavený Google Maps API kľúč, rozšírenie môže doplniť chýbajúcu ulicu, číslo alebo obec. Vyhľadávanie je obmedzené na Slovensko a existujúce vyplnené údaje sa neprepisujú.

Výsledky extrakcie sa dočasne ukladajú do pamäte relácie, aby opakované otvorenie rovnakého obsahu nemuselo znovu volať AI. Bežná platnosť výsledku je 10 minút; pri neúplných výsledkoch alebo upozorneniach 30 sekúnd. Tlačidlo **Načítať podujatie znova** vynúti novú extrakciu.

## Inštalácia a nastavenie

Projekt používa JavaScript, HTML a CSS bez zostavovania a inštalácie balíkov. Manifest vyžaduje Chrome 110 alebo novší.

1. Stiahnite projekt a rozbaľte ho do priečinka.
2. V súbore [config.js](config.js) doplňte vlastný Gemini API kľúč do poľa `geminiKeys`.
3. Voliteľne doplňte `googleMapsKey` pre vyhľadávanie adries cez Google Maps Geocoding API.
4. V Chrome otvorte `chrome://extensions` a zapnite **Režim vývojára**.
5. Kliknite na **Načítať rozbalené** a vyberte priečinok obsahujúci `manifest.json`.
6. Obnovte otvorenú stránku podujatia a otvorte rozšírenie.

Pole `geminiKeys` môže obsahovať viac kľúčov; pri vybraných chybách API rozšírenie skúsi ďalší. Stačí aj jeden platný kľúč. Bez Gemini kľúča zostáva dostupné spracovanie použiteľných štruktúrovaných údajov, AI analýza však neprebehne.

Po zmene konfigurácie obnovte rozšírenie na stránke `chrome://extensions`. Vlastné API kľúče nevkladajte do verejného repozitára.

## Bežné použitie

1. Otvorte webovú stránku podujatia.
2. Otvorte rozšírenie kliknutím na jeho ikonu alebo skratkou **Alt+Y**. Na macOS je v manifeste navrhnutá skratka **Command+Shift+Y**.
3. Počkajte na extrakciu, prípadne použite **Načítať všetky zo zoznamu**.
4. Skontrolujte názov, dátumy, miesto a kontaktné údaje. E-mail sa automaticky neextrahuje; predvyplnená hodnota `email@example.com` je iba ukážková a dá sa upraviť.
5. Kliknite na **Uložiť**. Vybrané podujatie sa uloží lokálne v rozšírení.
6. Na stránke s kompatibilným formulárom stlačte **Alt+X**.

Vkladanie používa konkrétne HTML identifikátory polí uvedené v [paste.js](paste.js), preto nefunguje automaticky na ľubovoľnom formulári:

| Údaj | ID cieľového poľa |
| --- | --- |
| Názov podujatia | `title` |
| Dátum od | `from` |
| Dátum do | `to` |
| Miesto konania | `place_name` |
| Ulica | `street` |
| Číslo | `street_no` |
| Obec | `locationSearch` |
| E-mail | `event-email` |
| Web podujatia | `event-website` |

Skratka reaguje iba na stránke, ktorá obsahuje polia `title`, `from`, `to`, `place_name` a `locationSearch`. Vloží neprázdne uložené hodnoty a vyvolá udalosti `input` a `change`. Dátumy sa pri ukladaní prevedú na formát `DD.MM.YYYY`. Formulár sa automaticky neodosiela.

## Zjednodušené sťahovanie obrázkov

Kliknite pravým tlačidlom na obrázok alebo plagát a vyberte **Stiahnuť obrázok (JPEG)**. Rozšírenie sa pokúsi nájsť zdroj obrázka aj v podporovaných galériách alebo obrázkoch na pozadí a previesť ho do JPEG s bielym pozadím.

Názov súboru sa vytvorí z posledného uloženého podujatia: z jeho názvu, obce a roku. Diakritika a medzery sa upravia na názov vhodný pre súbor, napríklad `letny-koncert-bratislava-2026.jpeg`. Bez dostupných údajov sa použije `event-image.jpeg`.

Pri ukladaní sa navrhne priečinok `EventImages` a zobrazí sa dialóg na výber umiestnenia. Ak konverzia do JPEG zlyhá, rozšírenie skúsi stiahnuť pôvodný zdroj. V tomto prípade obsah súboru nemusí byť JPEG, aj keď navrhnutý názov má príponu `.jpeg`.

## Spracovanie údajov

Pri AI analýze sa vybraný text, URL, kontext stránky a prípadne obrázok odosielajú do Google Gemini API. Pri dopĺňaní adresy sa údaje o mieste odosielajú do Google Maps API. Rozšírenie nemá vlastný server.

Posledné ručne uložené podujatie zostáva v `chrome.storage.local`; dočasné výsledky extrakcie a vyhľadávania adries sa ukladajú v `chrome.storage.session`.

## Súbory projektu

| Súbor | Úloha |
| --- | --- |
| [manifest.json](manifest.json) | Nastavenia rozšírenia, oprávnenia, skripty a skratky. |
| [config.js](config.js) | Konfigurácia modelu a API kľúčov. |
| [content.js](content.js) | Čítanie obsahu stránky, štruktúrovaných dát a vyhľadávanie obrázkov. |
| [event-data.js](event-data.js) | Spracovanie štruktúrovaných podujatí, dátumov a adries. |
| [extractor.js](extractor.js) | Extrakcia, volania Gemini a Google Maps, dočasná pamäť výsledkov. |
| [background.js](background.js) | Obsluha správ rozšírenia a sťahovanie obrázkov. |
| [popup.html](popup.html), [popup.js](popup.js) | Rozhranie na výber, kontrolu, úpravu a uloženie podujatia. |
| [paste.js](paste.js) | Vkladanie uložených údajov do kompatibilného formulára. |
