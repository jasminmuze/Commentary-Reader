import React, { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useReportContent } from "@workspace/api-client-react";
import type { ReportContentInput } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useUser } from "@/context/UserContext";
import { ThemedActionSheet } from "./ThemedActionSheet";

const REASONS: {
  value: ReportContentInput["reason"];
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}[] = [
  { value: "spam", label: "Spam", icon: "slash" },
  { value: "harassment", label: "Harassment or bullying", icon: "users" },
  { value: "hate_or_abusive_content", label: "Hate or abusive content", icon: "alert-triangle" },
  { value: "sexual_content", label: "Sexual content", icon: "eye-off" },
  { value: "copyright", label: "Copyright concern", icon: "file-text" },
  { value: "other", label: "Other", icon: "flag" },
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
  const [feedback, setFeedback] = useState<{
    title: string;
    description: string;
  } | null>(null);

  if (!user || user.id === targetUserId) return null;

  const submit = (reason: ReportContentInput["reason"]) => {
    setPickerVisible(false);
    report.mutate(
      { data: { targetType, targetId, reason } },
      {
        onSuccess: () =>
          setFeedback({
            title: "Report received",
            description: "Thank you. We’ll review this report.",
          }),
        onError: () =>
          setFeedback({
            title: "Couldn’t send report",
            description: "Please try again in a moment.",
          }),
      },
    );
  };

  const closePicker = () => setPickerVisible(false);

  return (
    <>
      <ThemedActionSheet
        visible={pickerVisible}
        title={targetType === "user" ? "Report account" : "Report content"}
        description="Choose the reason that best describes it."
        onClose={closePicker}
        cancelTestID="report-cancel"
        actions={REASONS.map((reason) => ({
          label: reason.label,
          icon: reason.icon,
          testID: `report-reason-${reason.value}`,
          disabled: report.isPending,
          onPress: () => submit(reason.value),
        }))}
      />
      <ThemedActionSheet
        visible={feedback !== null}
        title={feedback?.title ?? ""}
        description={feedback?.description}
        onClose={() => setFeedback(null)}
        cancelLabel={null}
        actions={[
          {
            label: "Done",
            icon: "check-circle",
            onPress: () => setFeedback(null),
          },
        ]}
      />
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
