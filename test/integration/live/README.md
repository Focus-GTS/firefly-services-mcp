# Live integration tests

Tests in this directory hit the **real** Adobe Firefly Services sandbox.

They are gated behind `FIREFLY_SERVICES_INTEGRATION_TEST=1` and require:

- `FIREFLY_SERVICES_CLIENT_ID` — real OAuth Server-to-Server client id
- `FIREFLY_SERVICES_CLIENT_SECRET` — corresponding secret

Run with:

```bash
npm run test:integration:live
```

Without credentials these tests skip themselves with a console message.
They share the same assertions as `test/integration/{firefly,photoshop,lightroom}.test.ts`
but call the real API instead of MSW.
