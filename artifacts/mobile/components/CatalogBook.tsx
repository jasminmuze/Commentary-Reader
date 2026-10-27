import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useSearchBookCatalog,
  getSearchBookCatalogQueryKey,
} from "@workspace/api-client-react";
import type { BookCatalogItem, BookCatalogSearchResult } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

type Colors = ReturnType<typeof useColors>;

export const SOURCE_LABEL: Record<BookCatalogSearchResult["source"], string> = {
  open_library: "Open Library",
  google_books: "Google Books",
};

/** Debounced catalog search with page state that resets whenever the query changes. */
export function useCatalogSearch(rawQuery: string, delay = 600) {
  const normalizedQuery = rawQuery.trim().slice(0, 160);
  const [debounced, setDebounced] = useState(normalizedQuery);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(normalizedQuery);
      setPage(1);
    }, delay);
    return () => clearTimeout(t);
  }, [normalizedQuery, delay]);

  const params = { q: debounced, page };
  const query = useSearchBookCatalog(params, {
    query: {
      enabled: debounced.length >= 2,
      retry: false,
      staleTime: 5 * 60 * 1000,
      queryKey: getSearchBookCatalogQueryKey(params),
    },
  });

  const settled = debounced === normalizedQuery;
  // Only show data that belongs to this exact query + page.
  const data = settled && query.data && query.data.page === page ? query.data : undefined;

  return {
    q: debounced,
    page,
    setPage,
    settled,
    data,
    items: data?.items ?? [],
    isLoading: !settled || (debounced.length >= 2 && query.isFetching && !data),
    isError: settled && query.isError,
    refetch: query.refetch,
    active: debounced.length >= 2,
  };
}

export function CatalogCover({
  uri,
  title,
  width = 56,
  height = 84,
}: {
  uri: string | null | undefined;
  title: string;
  width?: number;
  height?: number;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const safe = uri && /^https?:\/\//i.test(uri) ? uri.replace(/^http:/i, "https:") : null;

  if (safe && !failed) {
    return (
      <Image
        source={{ uri: safe }}
        onError={() => setFailed(true)}
        style={[styles.cover, { width, height, backgroundColor: colors.muted }]}
        resizeMode="cover"
        accessibilityLabel={`Cover of ${title}`}
      />
    );
  }
  return (
    <View
      style={[styles.cover, styles.placeholder, { width, height, backgroundColor: colors.secondary, borderColor: colors.border }]}
      accessibilityLabel="No cover available"
    >
      <Feather name="book" size={Math.round(width / 3)} color={colors.mutedForeground} />
      {width >= 80 ? (
        <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>No cover</Text>
      ) : null}
    </View>
  );
}

function metaLine(item: BookCatalogItem) {
  const year = item.publishedDate ? item.publishedDate.slice(0, 4) : null;
  return [year, item.pageCount ? `${item.pageCount} pages` : null, item.language?.toUpperCase()]
    .filter(Boolean)
    .join(" · ");
}

export function CatalogRow({
  item,
  onPress,
  actionIcon = "chevron-right",
  disabled,
}: {
  item: BookCatalogItem;
  onPress: () => void;
  actionIcon?: React.ComponentProps<typeof Feather>["name"];
  disabled?: boolean;
}) {
  const colors = useColors();
  const meta = metaLine(item);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, opacity: pressed || disabled ? 0.7 : 1 },
      ]}
    >
      <CatalogCover uri={item.coverUrl} title={item.title} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[styles.author, { color: colors.mutedForeground }]} numberOfLines={1}>{item.author}</Text>
        {meta ? <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{meta}</Text> : null}
        {item.isbn ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>ISBN {item.isbn}</Text> : null}
        {item.description ? (
          <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </View>
      <Feather name={actionIcon} size={19} color={colors.primary} />
    </Pressable>
  );
}

export function CatalogStatus({
  search,
  emptyHint,
  colors,
}: {
  search: ReturnType<typeof useCatalogSearch>;
  emptyHint: string;
  colors: Colors;
}) {
  if (!search.active && search.settled) {
    return <Text style={[styles.status, { color: colors.mutedForeground }]}>Search by title, author, or ISBN.</Text>;
  }
  if (search.isLoading) {
    return (
      <View>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <View style={[styles.cover, { width: 56, height: 84, backgroundColor: colors.muted }]} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={[styles.bar, { width: "75%", backgroundColor: colors.muted }]} />
              <View style={[styles.bar, { width: "45%", backgroundColor: colors.muted }]} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (search.isError) {
    return (
      <View style={styles.errorBox}>
        <Text style={[styles.status, { color: colors.mutedForeground }]}>The book catalog is not responding right now.</Text>
        <Pressable onPress={() => search.refetch()} style={[styles.retry, { borderColor: colors.primary }]}>
          <Feather name="refresh-cw" size={14} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return <Text style={[styles.status, { color: colors.mutedForeground }]}>{emptyHint}</Text>;
}

export function CatalogFooter({ search, colors }: { search: ReturnType<typeof useCatalogSearch>; colors: Colors }) {
  const data = search.data;
  if (!data) return null;
  return (
    <View style={{ gap: 10, marginTop: 4 }}>
      {data.notice ? <Text style={[styles.notice, { color: colors.mutedForeground }]}>{data.notice}</Text> : null}
      {data.page > 1 || data.hasMore ? (
        <View style={styles.pager}>
          <Pressable
            disabled={data.page <= 1}
            onPress={() => search.setPage(data.page - 1)}
            style={[styles.pageBtn, { borderColor: colors.border, opacity: data.page <= 1 ? 0.4 : 1 }]}
            accessibilityLabel="Previous page"
          >
            <Feather name="chevron-left" size={18} color={colors.foreground} />
          </Pressable>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Page {data.page}</Text>
          <Pressable
            disabled={!data.hasMore}
            onPress={() => search.setPage(data.page + 1)}
            style={[styles.pageBtn, { borderColor: colors.border, opacity: data.hasMore ? 1 : 0.4 }]}
            accessibilityLabel="Next page"
          >
            <Feather name="chevron-right" size={18} color={colors.foreground} />
          </Pressable>
        </View>
      ) : null}
      <Text style={[styles.attrib, { color: colors.mutedForeground }]}>
        Book information from {SOURCE_LABEL[data.source]}. Catalog entries are book records, not EPUB files.
      </Text>
    </View>
  );
}

export function CatalogDetailSheet({
  item,
  source,
  onClose,
  onOpenCommunity,
  opening,
}: {
  item: BookCatalogItem | null;
  source?: BookCatalogSearchResult["source"];
  onClose: () => void;
  onOpenCommunity: (item: BookCatalogItem) => void;
  opening: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!item} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      {item ? (
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 20 }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 16 }}>
              <CatalogCover uri={item.coverUrl} title={item.title} width={96} height={144} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.author, { color: colors.mutedForeground }]}>{item.author}</Text>
                {[
                  item.publisher,
                  item.publishedDate,
                  item.pageCount ? `${item.pageCount} pages` : null,
                  item.language ? item.language.toUpperCase() : null,
                  item.isbn ? `ISBN ${item.isbn}` : null,
                ]
                  .filter(Boolean)
                  .map((line) => (
                    <Text key={line as string} style={[styles.meta, { color: colors.mutedForeground }]}>{line}</Text>
                  ))}
              </View>
            </View>
            <View style={[styles.epubNote, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
              <Feather name="info" size={14} color={colors.secondaryForeground} />
              <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: colors.secondaryForeground }}>
                This is a catalog record; edition details may vary. Shelfmates does not provide the book itself. Upload your own EPUB to read along.
              </Text>
            </View>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {item.description || "No description available from the catalog."}
            </Text>
            <Pressable
              onPress={() => onOpenCommunity(item)}
              disabled={opening}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: pressed || opening ? 0.8 : 1 }]}
            >
              {opening ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather name="users" size={17} color={colors.primaryForeground} />
                  <Text style={{ color: colors.primaryForeground, fontWeight: "700", fontSize: 15 }}>View community</Text>
                </>
              )}
            </Pressable>
            {item.infoUrl ? (
              <Pressable onPress={() => Linking.openURL(item.infoUrl)} style={styles.linkBtn}>
                <Feather name="external-link" size={14} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  View on {source ? SOURCE_LABEL[source] : "catalog"}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: 5 },
  placeholder: { alignItems: "center", justifyContent: "center", borderWidth: 1, gap: 4 },
  placeholderText: { fontSize: 10, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderWidth: 1, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  author: { fontSize: 13 },
  meta: { fontSize: 11, marginTop: 2 },
  desc: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  status: { fontSize: 13, lineHeight: 19, textAlign: "center", padding: 8 },
  bar: { height: 10, borderRadius: 5 },
  errorBox: { alignItems: "center", gap: 8, paddingVertical: 6 },
  retry: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  notice: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  pageBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  attrib: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(44,38,33,0.45)" },
  sheet: { maxHeight: "85%", borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10 },
  sheetTitle: { fontSize: 20, fontWeight: "700", letterSpacing: -0.4 },
  epubNote: { flexDirection: "row", gap: 8, padding: 12, alignItems: "flex-start" },
  body: { fontSize: 14, lineHeight: 21 },
  primaryBtn: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  linkBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 6 },
});
