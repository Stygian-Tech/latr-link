# XRPC external-repository rollout

The directly addressed XRPC server and the L@tr.link web/extension consumers live in this repository. The remaining contract publication and cross-product work must land in the repositories that own those artifacts; this checkout must not duplicate their canonical sources.

## `Stygian-Tech/latr-packages`

1. Add the 17 `link.latr.*` query/procedure Lexicons listed in [latr-gateway.md](./latr-gateway.md), plus `link.latr.saved.defs` and `link.latr.developer.defs`.
2. Declare every parameter, JSON input/output, and stable endpoint error. Validate NSIDs, references, formats, enums, required properties, and UTF-8 byte limits with the official Lexicon validator.
3. Generate the TypeScript method descriptors and client types. Replace the provisional descriptors in `packages/latr-web-client/src/xrpcMethods.ts` by updating the root git dependency to the published `latr-packages` revision.
4. Publish the Lexicons as `com.atproto.lexicon.schema` records, configure `_lexicon.<group>.latr.link` TXT authorities, and commit a versioned NSID-to-CID manifest.
5. Add Swift/TypeScript golden fixtures for parameters, inputs, outputs, and errors.

## `Stygian-Tech/latr-kit`

1. Generate and commit Swift method descriptors and Codable contracts from the pinned `latr-packages` revision.
2. Add `XRPCTransport` and `LatrXRPCClient`; bind its auth/header provider to the resolved method, verb, and URL.
3. Validate method payloads and repository records against the generated constraints before transmission.
4. Preserve unknown Lexicon fields across decode/rewrite operations.
5. Add `swapRecord` support to mutations. State changes and deletes must use the fetched CID, retry one safe conflict, then surface typed `Conflict`.
6. Replace invalid-record skipping with `InvalidStoredRecord`, logging only the affected AT URI.
7. Tag a release and update `services/latr-gateway/Package.swift` to its immutable revision.

## Other consumers

- Update `Stygian-Tech/latrkit-dev` to the generated developer-management client.
- Update The Social Wire read-later mutations to the generated XRPC client.
- Run direct-origin and same-origin-proxy DPoP wire tests against the development gateway.

## Release gates

Deploy the gateway and testing consumers to development only after the external contract revisions are pinned. Verify exact `/xrpc/<nsid>` traffic, cursor pagination, PDS records, proof-pool consumption, and save/state/delete/developer-key flows. Production deployment requires a separate approval after development review. Removing `/v1/latr/*` is a later breaking release with its own approval.
