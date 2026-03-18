# CLAUDE.md — Spout Backend Solana

## Project Overview

Spout Finance backend service that monitors Solana blockchain for buy/sell order events and automatically processes token minting/burning. Bridges traditional investment assets (U.S. bonds, equities) with blockchain technology.

**Stack:** NestJS + TypeScript + Solana (Devnet) + Anchor + Supabase
**Database:** Supabase (order persistence and deduplication). Token state lives on-chain via Solana PDAs and token accounts.

## Architecture

```
src/
├── main.ts                          # Bootstrap, CORS (origin: *), Swagger at /api, port 3000
├── app.module.ts                    # Root module (ConfigModule, ScheduleModule, PoolingModule, Web3Module, KycModule, OrdersModule)
├── app.controller.ts                # GET / health check
├── app.service.ts                   # Returns "Hello World!"
└── modules/
    ├── pooling/                     # Event monitoring
    │   ├── pooling.module.ts        # Imports Web3Module, SupabaseModule
    │   ├── pooling.service.ts       # Cron every 15s, polls Solana for order events, deduplicates via Supabase
    │   ├── decoder.ts              # Decodes BuyOrderCreated / SellOrderCreated events
    │   └── idl/program.json        # Anchor IDL for spoutsolana program
    ├── web3/                        # Blockchain interactions
    │   ├── web3.module.ts           # Exports Web3Service
    │   ├── web3.service.ts          # Token mint/burn logic, USDC compensation, ATA management
    │   └── web3.controller.ts       # GET /web3/health
    ├── supabase/                    # Database layer
    │   ├── supabase.module.ts       # Exports SupabaseService
    │   └── supabase.service.ts      # Order persistence, deduplication by tx hash, paginated queries
    ├── orders/                      # Order query API
    │   ├── orders.module.ts         # Imports SupabaseModule
    │   ├── orders.service.ts        # Paginated order retrieval
    │   └── orders.controller.ts     # GET /orders/:userPubkey
    └── kyc/                         # KYC identity management
        ├── kyc.module.ts            # Exports KycService
        ├── kyc.service.ts           # On-chain identity creation and verification via ID program
        ├── kyc.controller.ts        # POST /kyc/create-identity-for-user
        └── idl/program.json         # Anchor IDL for ID program
```

## Core Business Flows

### Buy Order Flow
1. User places buy order on-chain via Spout program
2. `PoolingService` detects `BuyOrderCreated` event (15s cron)
3. `EventDecoder` extracts: user, ticker, tokenMint, usdcAmount, assetAmount, price, limitPrice, orderId, createdAt
4. `SupabaseService.processOrders()` deduplicates by transaction hash, inserts new orders with status `pending`
5. `Web3Service.mintToken()` → derives attestation PDA → creates ATA if needed → mints asset tokens

### Sell Order Flow
1. User places sell order on-chain
2. `PoolingService` detects `SellOrderCreated` event
3. Orders deduplicated and persisted via Supabase (same as buy flow)
4. `Web3Service.burnToken()` → burns asset tokens from user
5. `Web3Service.mintUsdcTokens()` → mints USDC compensation to user

### KYC Identity Flow
1. `POST /kyc/create-identity-for-user` with user wallet pubkey
2. Derives config and identity PDAs from ID program
3. Calls `create_identity_for_user` instruction on-chain
4. Calls `set_verified(true)` to mark identity as KYC verified

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Health check |
| GET | `/web3/health` | Web3 module health |
| GET | `/orders/:userPubkey` | Get paginated orders for a user (`?page=1&limit=10`) |
| POST | `/kyc/create-identity-for-user` | Create on-chain KYC identity for user |

## Key Environment Variables (.env)

| Variable | Purpose |
|----------|---------|
| `SPOUT_PROGRAM_ID` | Main Solana program address |
| `SAS_PROGRAM_ID` | Solana Attestation Service program |
| `ID_PROGRAM_ID` | KYC Identity program |
| `TOKEN_PROGRAM_ID` | SPL Token program (Token-2022) |
| `USDC_TOKEN_PROGRAM_ID` | USDC token program (legacy SPL) |
| `ASSOCIATED_TOKEN_PROGRAM_ID` | ATA program |
| `SCHEMA_PDA` | Attestation schema account |
| `CREDENTIAL_PDA` | Attestation credential account |
| `CONFIG_PDA` | Program config PDA |
| `LQD_PUBKEY` | Asset token mint address |
| `USDC_PUBKEY` | USDC token mint address |
| `ISSUER_KEYPAIR` | JSON array of secret key bytes (signs all txs) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

## Supabase Schema

**`orders` table:**
- `id` (bigint, auto-generated primary key)
- `transaction_hash` (text, unique) — Solana transaction signature
- `order_type` (text) — `buy` or `sell`
- `status` (text) — `pending`, `fulfilled`, or `failed`
- `user_pubkey` (text) — user's Solana wallet address
- `ticker`, `token_mint`, `usdc_amount`, `asset_amount`, `price`, `limit_price`, `order_id` (text)
- `created_at_onchain` (timestamptz) — on-chain event timestamp
- `inserted_at` (timestamptz, default now())

## Important Solana Concepts

- **PDAs (Program Derived Addresses):** Deterministic addresses derived from seeds. Used for config, attestations, program authority, identity.
- **ATAs (Associated Token Accounts):** Per-user token accounts, created idempotently before minting.
- **Two token programs in use:** Token-2022 (`TokenzQd...`) for asset tokens, legacy SPL Token (`Tokenkeg...`) for USDC.
- **Anchor IDL** at `src/modules/pooling/idl/program.json` defines the on-chain Spout program interface.
- **Event polling** uses `getSignaturesForAddress` + `getTransaction` to parse logs. Deduplication handled via Supabase `transaction_hash` uniqueness.

## Commands

```bash
npm run start:dev     # Dev with hot reload
npm run start:prod    # Production (node dist/main)
npm run build         # Compile TypeScript
npm run lint          # ESLint with auto-fix
npm test              # Unit tests
npm run test:e2e      # End-to-end tests
```

## Dependencies

**Solana/Web3:** `@solana/web3.js`, `@solana/spl-token`, `@coral-xyz/anchor`, `bs58`
**Attestation/Identity:** `sas-lib`, `gill`
**Database:** `@supabase/supabase-js`
**NestJS:** `@nestjs/common`, `@nestjs/config`, `@nestjs/schedule`, `@nestjs/platform-express`, `@nestjs/swagger`

## Code Style

- **Prettier:** single quotes, trailing commas
- **ESLint:** TypeScript strict (with `no-explicit-any` off, floating promises/unsafe args as warnings)
- **TypeScript:** strict mode relaxed (no `noImplicitAny`), decorators + metadata enabled

## Development Notes

- Currently targets **Solana Devnet** only
- CORS is wide open (`*`) — must be restricted for production
- Issuer keypair in `.env` — needs secure secret management for production
- Swagger/OpenAPI docs available at `/api`
- Polling interval is 15 seconds; order deduplication handled by Supabase (transaction_hash unique constraint)
- Mint/burn execution is currently commented out in `PoolingService` (TODO: re-enable when ready)
- The `program.json` IDL has instructions: `balance`, `mint`, `burn`
- Order status lifecycle: `pending` → `fulfilled` / `failed`
