import AsyncHTTPClient
import Foundation
import LatrKit

public enum SaveURLPipeline {
    private static let maxHTMLBytes = 512 * 1024

    public static func run(
        url rawURL: String,
        library: SavedLibrary,
        httpClient: HTTPClient,
        repository: any RepositoryClient,
        subjectClient: FederatedSubjectClient
    ) async throws -> SaveURLPipelineResult {
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let pageURL = URL(string: trimmed),
              let scheme = pageURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else {
            throw GatewayError(status: .badRequest, message: "invalid url", code: "invalid_url")
        }

        let appView = subjectClient
        let linkedWebUrl = pageURL.absoluteString

        var nativeSubjectURI: String?
        if let profilePost = extractBskyAppProfilePostParts(from: pageURL),
           let did = await appView.resolveActorDID(profilePost.actor)
        {
            nativeSubjectURI = bskyPostSubjectURI(
                actor: profilePost.actor,
                rkey: profilePost.rkey,
                did: did
            )
        }

        var html = ""
        var resolvedPageURL = linkedWebUrl
        switch await fetchURLBodyLimited(
            target: linkedWebUrl,
            maxBytes: maxHTMLBytes,
            httpClient: httpClient
        ) {
        case let .success(text, finalURL):
            html = text
            resolvedPageURL = finalURL
            if nativeSubjectURI == nil, let fromHead = extractAtUriFromHead(text) {
                nativeSubjectURI = fromHead
            }
        case .failure:
            break
        }

        let headOgFields = await resolveOpenGraphForURL(
            url: linkedWebUrl,
            httpClient: httpClient,
            prefetchedHTML: html.isEmpty ? nil : html,
            prefetchedFinalURL: resolvedPageURL
        ) ?? enrichOpenGraphFields(
            degradedOpenGraphFields(from: linkedWebUrl),
            resolvedPageURL: linkedWebUrl
        )
        let headOgPreview = openGraphPreview(from: headOgFields)

        if let subjectURI = nativeSubjectURI {
            let resolver = SubjectPreviewResolver(
                repository: repository,
                appView: appView,
                untyped: appView
            )
            let subjectPreview = await resolver.preview(for: subjectURI)
            let merged = OpenGraphMerger.merge(primary: subjectPreview, fallback: headOgPreview)

            try await library.save(
                subjectURI: subjectURI,
                linkedWebURL: linkedWebUrl,
                preview: merged
            )

            return SaveURLPipelineResult(
                kind: "subject",
                subjectUri: subjectURI,
                linkedWebUrl: linkedWebUrl,
                storage: "native"
            )
        }

        try await library.save(url: linkedWebUrl, preview: headOgPreview)
        let externalKey = RecordKey.key(
            forNormalizedURL: URLNormalizer.normalizedString(from: linkedWebUrl) ?? linkedWebUrl
        )
        let wrapperURI = ATURI.externalSave(repositoryDID: library.repositoryDID, recordKey: externalKey)

        return SaveURLPipelineResult(
            kind: "url",
            subjectUri: wrapperURI,
            linkedWebUrl: linkedWebUrl,
            storage: "external"
        )
    }
}

private func openGraphPreview(from fields: OpenGraphFields) -> OpenGraphPreview {
    OpenGraphPreview(
        title: fields.title,
        description: fields.description,
        image: fields.image,
        siteName: fields.siteName,
        author: fields.author
    )
}
