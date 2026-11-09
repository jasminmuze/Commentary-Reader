import React, { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useReportContent } from "@workspace/api-client-react";
import type { ReportContentInput } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";

const REASONS: { value: ReportContentInput["reason"]; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_or_abusive_content", label: "Hate or abusive content" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "copyright", label: "Copyright concern" },
  { value: "other", label: "Other" },
];

export function ReportContentButton({
  targetType,
  targetId,
  targetUserId,
  showLabel = false,
}: {
  targetType: ReportContentInput["targetType"];
  targetId: number;
  targetUserId: number;
  showLabel?: boolean;
}) {
  const colors = useColors();
  const { user } = useUser();
  const report = useReportContent();
  const [pickerVisible, setPickerVisible] = useState(false);

  if (!user || user.id === targetUserId) return null;

  const submit = (reason: ReportContentInput["reason"]) => {
    setPickerVisible(false);
    report.mutate(
      { data: { targetType, targetId, reason } },
      {
        onSuccess: () =>
          Alert.alert("Report received", "Thank you. We’ll review this report."),
        onError: () =>
          Alert.alert("Couldn’t send report", "Please try again in a moment."),
      },
    );
  };

  const closePicker = () => setPickerVisible(false);

  return (
    <>
      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={closePicker}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close report options"
            onPress={closePicker}
          />
          <View
            style={[
              styles.dialog,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                shadowColor: colors.foreground,
              },
            ]}
          >
            <Text style={[styles.title, { color: colors.foreground }]}>
              {targetType === "user" ? "Report account" : "Report content"}
            </Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Choose the reason that best describes it.
            </Text>
            <ScrollView
              style={styles.reasonList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {REASONS.map((reason) => (
                <Pressable
                  key={reason.value}
                  accessibilityRole="button"
                  accessibilityLabel={reason.label}
                  testID={`report-reason-${reason.value}`}
                  disabled={report.isPending}
                  onPress={() => submit(reason.value)}
                  style={({ pressed }) => [
                    styles.reason,
                    { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Text style={[styles.reasonText, { color: colors.foreground }]}>
                    {reason.label}
                  </Text>
                  <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel report"
              testID="report-cancel"
              onPress={closePicker}
              style={({ pressed }) => [
                styles.cancel,
                {
                  backgroundColor: colors.muted,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report content"
        disabled={report.isPending}
        hitSlop={8}
        onPress={() => setPickerVisible(true)}
        style={({ pressed }) => [
          styles.button,
          showLabel ? styles.withLabel : null,
          { opacity: pressed || report.isPending ? 0.55 : 1 },
        ]}
      >
        <Feather name="flag" size={showLabel ? 15 : 16} color={colors.mutedForeground} />
        {showLabel ? (
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Report</Text>
        ) : null}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(24, 20, 17, 0.38)",
  },
  dialog: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "82%",
    overflow: "hidden",
    borderWidth: 1,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 16,
    elevation: 12,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
  },
  description: {
    marginTop: 7,
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  reasonList: {
    flexShrink: 1,
  },
  reason: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reasonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  cancel: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "700",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  withLabel: {
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});
