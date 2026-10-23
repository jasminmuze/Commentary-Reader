import React from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
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

  if (!user || user.id === targetUserId) return null;

  const submit = (reason: ReportContentInput["reason"]) => {
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

  const openReasons = () => {
    Alert.alert(
      targetType === "user" ? "Report account" : "Report content",
      "Choose the reason that best describes it.",
      [
      ...REASONS.map((reason) => ({
        text: reason.label,
        onPress: () => submit(reason.value),
      })),
      { text: "Cancel", style: "cancel" as const },
      ],
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Report content"
      disabled={report.isPending}
      hitSlop={8}
      onPress={openReasons}
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
  );
}

const styles = StyleSheet.create({
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
