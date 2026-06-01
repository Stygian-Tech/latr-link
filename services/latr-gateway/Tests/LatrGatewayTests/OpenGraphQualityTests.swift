import LatrGatewayLib
import Testing

@Suite("OpenGraphQuality")
struct OpenGraphQualityTests {
    @Test("detects weak site-only titles")
    func weakTitles() {
        #expect(
            isWeakOpenGraphTitle(
                "The Verge",
                siteName: "The Verge",
                pageURL: "https://www.theverge.com/features/937620/example"
            )
        )
        #expect(
            isWeakOpenGraphTitle(
                "theverge.com",
                siteName: nil,
                pageURL: "https://www.theverge.com/features/937620/example"
            )
        )
        #expect(
            isWeakOpenGraphTitle(
                "Roids were all the rage at the Enhanced Games",
                siteName: "The Verge",
                pageURL: "https://www.theverge.com/features/937620/example"
            ) == false
        )
    }

    @Test("needs reader enhancement when og image meta is missing")
    func needsEnhancement() {
        let fields = OpenGraphFields(title: "The Verge", siteName: "The Verge")
        let signals = OpenGraphMetaSignals(hasExplicitTitle: false, hasExplicitImage: false)
        #expect(
            openGraphNeedsReaderEnhancement(
                fields: fields,
                signals: signals,
                pageURL: "https://www.theverge.com/features/937620/example"
            )
        )
    }

    @Test("merge prefers reader proxy title and image")
    func mergeFields() {
        let merged = mergeOpenGraphFields(
            primary: OpenGraphFields(
                title: "Article Headline",
                image: "https://cdn.example/hero.jpg",
                siteName: "The Verge"
            ),
            fallback: OpenGraphFields(title: "The Verge", siteName: "The Verge")
        )
        #expect(merged.title == "Article Headline")
        #expect(merged.image == "https://cdn.example/hero.jpg")
    }
}

@Suite("OpenGraphMetaSignals")
struct OpenGraphMetaSignalsTests {
    @Test("reads explicit og meta flags from head html")
    func parseSignals() {
        let html = """
        <head>
          <title>The Verge</title>
          <meta property="og:title" content="Article Headline" />
          <meta property="og:image" content="https://cdn.example/hero.jpg" />
        </head>
        """
        let signals = openGraphMetaSignals(
            html: html,
            resolvedPageURL: "https://www.theverge.com/article"
        )
        #expect(signals.hasExplicitTitle)
        #expect(signals.hasExplicitImage)
    }

    @Test("document title alone is not explicit og title")
    func documentTitleOnly() {
        let html = """
        <head><title>The Verge</title></head>
        """
        let signals = openGraphMetaSignals(
            html: html,
            resolvedPageURL: "https://www.theverge.com/article"
        )
        #expect(signals.hasExplicitTitle == false)
        #expect(signals.hasExplicitImage == false)
    }
}
