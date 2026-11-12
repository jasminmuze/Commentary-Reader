import React, { useRef } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export interface ThemedAction {
  label: string;
  description?: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
  onPress: () => void;
}

export function ThemedActionSheet({
  visible,
  title,
  description,
  actions,
  onClose,
  cancelLabel = "Cancel",
  cancelTestID = "action-sheet-cancel",
}: {
  visible: boolean;
  title: string;
  description?: string;
  actions: ThemedAction[];
  onClose: () => void;
  cancelLabel?: string | null;
  cancelTestID?: string;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const pendingAction = useRef<(() => void) | null>(null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={() => {
        const action = pendingAction.current;
        pendingAction.current = null;
        action?.();
      }}
      statusBarTranslucent
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Dismiss options"
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Math.max(bottomInset, 16),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.heading}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            {description ? (
              <Text style={[styles.description, { color: colors.mutedForeground }]}>
                {description}
              </Text>
            ) : null}
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.actionList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {actions.map((action, index) => {
              const actionColor = action.destructive
                ? colors.destructive
                : colors.primary;
              return (
                <Pressable
                  key={`${action.label}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  disabled={action.disabled}
                  testID={action.testID}
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      // Finish dismissing before an action opens an edit or
                      // confirmation modal on top of the existing comment sheet.
                      pendingAction.current = action.onPress;
                      onClose();
                    } else {
                      action.onPress();
                      onClose();
                    }
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: action.disabled ? 0.45 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.iconWrap,
                      { backgroundColor: colors.muted },
                    ]}
                  >
                    <Feather name={action.icon} size={18} color={actionColor} />
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={[styles.actionLabel, { color: actionColor }]}>
                      {action.label}
                    </Text>
                    {action.description ? (
                      <Text
                        style={[
                          styles.actionDescription,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {action.description}
                      </Text>
                    ) : null}
                  </View>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          {cancelLabel !== null ? (
            <Pressable
              accessibilityRole="button"
              testID={cancelTestID}
              onPress={onClose}
              style={({ pressed }) => [
                styles.cancel,
                {
                  backgroundColor: colors.secondary,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.cancelLabel, { color: colors.secondaryForeground }]}>
                {cancelLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(36, 29, 24, 0.48)",
  },
  sheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 18,
  },
  heading: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  description: {
    marginTop: 5,
    fontSize: 14,
    lineHeight: 20,
  },
  scroll: {
    flexShrink: 1,
  },
  actionList: {
    gap: 9,
    paddingBottom: 2,
  },
  action: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  actionCopy: {
    flex: 1,
    gap: 2,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  actionDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  cancel: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 13,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
});
