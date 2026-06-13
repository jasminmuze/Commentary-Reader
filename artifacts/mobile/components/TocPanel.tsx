import React, { useMemo } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Section } from "@epubjs-react-native/core";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  toc: Section[];
  onSelect: (href: string) => void;
  onClose: () => void;
}

interface FlatItem {
  item: Section;
  depth: number;
}

function flattenToc(items: Section[], depth = 0): FlatItem[] {
  const result: FlatItem[] = [];
  for (const item of items) {
    result.push({ item, depth });
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      result.push(...flattenToc(item.subitems as Section[], depth + 1));
    }
  }
  return result;
}

export function TocPanel({ visible, toc, onSelect, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const flatItems = useMemo(() => flattenToc(toc), [toc]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.panel,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 8,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border + "80" }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            목차
          </Text>
          <Pressable onPress={onClose} hitSlop={16} style={styles.closeBtn}>
            <Text style={[styles.closeTxt, { color: colors.mutedForeground }]}>
              닫기
            </Text>
          </Pressable>
        </View>

        {flatItems.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            목차 정보가 없어요
          </Text>
        ) : (
          <FlatList
            data={flatItems}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item: { item, depth } }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingLeft: 20 + depth * 14,
                    opacity: pressed ? 0.55 : 1,
                    borderBottomColor: colors.border + "30",
                  },
                ]}
                onPress={() => {
                  onSelect(item.href);
                  onClose();
                }}
              >
                <Text
                  style={[
                    styles.rowText,
                    {
                      color:
                        depth === 0
                          ? colors.foreground
                          : colors.mutedForeground,
                      fontWeight: depth === 0 ? "600" : "400",
                    },
                  ]}
                  numberOfLines={2}
                >
                  {item.label.trim()}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#00000040",
  },
  panel: {
    maxHeight: "65%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeTxt: {
    fontSize: 14,
  },
  row: {
    paddingVertical: 13,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    textAlign: "center",
    paddingVertical: 40,
    fontSize: 14,
  },
});
