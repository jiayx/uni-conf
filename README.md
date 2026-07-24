# UniConf

> **Manage once, export everywhere.**  
> 一站式代理配置管理工具 / One-stop proxy configuration management tool

UniConf lets you manage proxy subscriptions, nodes, filtering rules, strategy groups, and traffic routing rules in one place, then export complete configuration files for different proxy clients.

## Supported Export Formats

| Format | Status | Client |
|--------|--------|--------|
| Mihomo YAML | ✅ | Mihomo, Clash Verge Rev, FlClash, etc. |
| Clash YAML | ✅ | ClashX, ClashN, OpenClash, etc. |
| sing-box JSON | ✅ | SFI, SFA, SFM, etc. |
| Loon CONF | ✅ | Loon (iOS) |
| Surge CONF | ✅ | Surge (iOS/macOS) |
| Quantumult X | ✅ | Quantumult X (iOS) |
| Shadowrocket | ✅ | Shadowrocket (iOS) |
| Stash YAML | ✅ | Stash (iOS) |
| Egern YAML | ✅ | Egern (iOS/macOS) |
| Node Subscription | ✅ | V2rayN, V2rayNG, NekoBox, etc. |

## Tech Stack

- **Frontend**: Vite 8 + React 19 + TypeScript 7 + Zustand + i18next
- **Backend**: Hono 4 + Cloudflare Workers + D1 (SQLite)
- **Styling**: Vanilla CSS + CSS Modules
- **Tests**: Vitest + React Testing Library
- **Deploy**: Cloudflare Workers + Static Assets

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
- [Operations and Release Runbook](./docs/OPERATIONS.md)
- [Contributing](./docs/CONTRIBUTING.md)

## License

MIT
