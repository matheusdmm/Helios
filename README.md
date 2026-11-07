# Helios

Helios is a local dashboard for the Solis S6-GR1P6K inverter with an S3-WIFI-ST data logger. It shows live power, production history, and estimates from readings saved on your computer.

## Run locally

Install [Bun](https://bun.sh/docs/installation) 1.4 or newer. Connect your computer to the same network as the data logger, then run:

```sh
cp .env.example .env
bun install
bun run start
```

Open `http://127.0.0.1:3000`. Click **Devices**, select the data logger, and enter the password for its local web page. You can also set `S3_IP` and `S3_PASSWORD` in `.env`.

Helios reads `http://LOGGER_IP/inverter.cgi` about once a minute and saves readings in `data/`. Without a configured logger, the dashboard shows labeled sample data. If a connected logger stops responding, the dashboard shows an error and keeps the last reading.

## Notes

- The logger and computer must be on the same local network. If discovery fails, enter the logger's IP manually.
- History starts when Helios begins recording. Missing days are not counted as zero production.
- Peaks are the highest values observed during polling. A higher peak between readings may be missed.
- Monetary values use the configured BRL/kWh rate. They are estimates, not electricity bill savings.
- To access the dashboard from another device on your network, set `HOST` to your computer's local IP and allow the port through its firewall.

## Development

```sh
bun run build   # Build the browser code
bun run check   # Check types
bun test        # Run tests
bun run dev     # Watch the server
```

## Windows executable

Run `bun run build:exe` on Windows. The result is `dist/helios.exe`, with the browser files embedded and the same Martell sun icon as the dashboard. Copy that one file to a writable folder on the target computer and double-click it. Bun and `node_modules` are not needed there. Open `http://127.0.0.1:3000` in a browser; keep the console window open while using the dashboard.

The executable starts with sample data. To configure a logger or change the port, place a `.env` file beside `helios.exe` (you can copy `.env.example` as a starting point). Settings and readings are stored in a `data/` folder beside the executable. Choose a folder where your Windows user can write files.

## Credit

The logo uses [House Martell.svg](https://awoiaf.westeros.org/index.php/File:House_Martell.svg) by [Abjiklam](https://awoiaf.westeros.org/index.php/User:Abjiklam), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The app icons use the same license.
