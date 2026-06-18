# UniConf

> **Manage once, export everywhere.**  
> 一站式代理配置管理工具 / One-stop proxy configuration management tool

UniConf lets you manage proxy subscriptions, nodes, filtering rules, strategy groups, and traffic routing rules in one place, then export complete configuration files for different proxy clients.

## Supported Export Formats

| Format | Status | Client |
|--------|--------|--------|
| Mihomo YAML | ✅ MVP | Mihomo, Clash Verge Rev, FlClash, etc. |
| Clash YAML | ✅ MVP | ClashX, ClashN, OpenClash, etc. |
| sing-box JSON | ✅ MVP | SFI, SFA, SFM, etc. |
| Loon CONF | ✅ MVP | Loon (iOS) |
| Node Subscription | ✅ MVP | V2rayN, V2rayNG, NekoBox, etc. |
| Surge CONF | 🔄 V2 | Surge (iOS/macOS) |
| Quantumult X | 🔄 V2 | Quantumult X (iOS) |
| Shadowrocket | 🔄 V2 | Shadowrocket (iOS) |
| Stash YAML | 🔄 V2 | Stash (iOS) |

## Tech Stack

- **Frontend**: Vite 8 + React 19 + TypeScript + Zustand + i18next
- **Backend**: Hono 4 + Cloudflare Workers + D1 (SQLite)
- **Styling**: Vanilla CSS + CSS Modules
- **Tests**: Vitest + React Testing Library
- **Deploy**: Cloudflare Pages + Workers

## Development

See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) for setup instructions.

```bash
# Install dependencies
pnpm install

# Start development
pnpm dev           # Frontend at http://localhost:5173
pnpm dev:worker    # Worker API at http://localhost:8787

# Run tests
pnpm test
pnpm test:coverage

# Build
pnpm build
```

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Data Model](./docs/DATA_MODEL.md)
- [Exporter Guide](./docs/EXPORTER_GUIDE.md)
- [Contributing](./docs/CONTRIBUTING.md)

## License

MIT
