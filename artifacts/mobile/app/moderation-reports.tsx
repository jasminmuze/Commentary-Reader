import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetModerationReportsQueryKey,
  useGetModerationAccess,
  useGetModerationReports,
  useUpdateModerationReport,
} from "@workspace/api-client-react";
import type {
  ModerationReport,
  ModerationReportStatus,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const REPORT_STATUSES: {
  value: ModerationReportStatus;
  label: string;
}[] = [
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const REASON_LABELS: Record<ModerationReport["reason"], string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate_or_abusive_content: "Hate or abusive content",
  sexual_content: "Sexual content",
  copyright: "Copyright",
  other: "Other",
};

const TARGET_LABELS: Record<ModerationReport["targetType"], string> = {
  comment: "Comment",
  highlight: "Highlight",
  user: "Account",
};

function displayName(user: ModerationReport["targetAuthor"]): string {
  if (!user) return "Unavailable account";
  return user.nickname?.trim() || `@${user.username}`;
}

export default function ModerationReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] =
    useState<ModerationReportStatus>("open");
  const access = useGetModerationAccess();
  const reports = useGetModerationReports(
    { status: selectedStatus, limit: 100 },
    {
      query: {
        enabled: access.data?.isModerator === true,
        queryKey: getGetModerationReportsQueryKey({
          status: selectedStatus,
          limit: 100,
        }),
      },
    },
  );
  const updateReport = useUpdateModerationReport();

  const changeStatus = (reportId: number, status: ModerationReportStatus) => {
    updateReport.mutate(
      { reportId, data: { status } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: ["/api/moderation/reports"],
          });
        },
        onError: () => {
          Alert.alert(
            "Couldn’t update report",
            "Please try again in a moment.",
          );
        },
      },
    );
  };

  const renderReport = (report: ModerationReport) => {
    const statusColor =
      report.status === "open"
        ? colors.accent
        : report.status === "reviewing"
          ? colors.primary
          : colors.mutedForeground;

    return (
      <View
        key={report.id}
        style={[
          styles.reportCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        <View style={styles.reportTopline}>
          <View style={styles.labels}>
            <Text style={[styles.reason, { color: colors.foreground }]}>
              {REASON_LABELS[report.reason]}
            </Text>
            <Text style={[styles.targetType, { color: colors.mutedForeground }]}>
              {TARGET_LABELS[report.targetType]}
            </Text>
          </View>
          <Text
            style={[styles.status, { color: statusColor }]}
            accessibilityLabel={`Status: ${report.status}`}
          >
            {report.status}
          </Text>
        </View>

        <Text style={[styles.targetAuthor, { color: colors.mutedForeground }]}>
          About {displayName(report.targetAuthor)}
        </Text>
        {report.targetPreview ? (
          <Text
            style={[styles.preview, { color: colors.foreground }]}
            numberOfLines={5}
          >
            {report.targetPreview}
          </Text>
        ) : report.targetType === "user" ? (
          <Text style={[styles.preview, { color: colors.mutedForeground }]}>
            Profile report
          </Text>
        ) : (
          <Text style={[styles.preview, { color: colors.mutedForeground }]}>
            Reported account or content is no longer available.
          </Text>
        )}

        {report.details ? (
          <View
            style={[
              styles.details,
              { backgroundColor: colors.secondary, borderRadius: colors.radius },
            ]}
          >
            <Text style={[styles.detailsLabel, { color: colors.secondaryForeground }]}>
              Reporter’s note
            </Text>
            <Text style={[styles.detailsText, { color: colors.secondaryForeground }]}>
              {report.details}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Reported by {report.reporter ? `@${report.reporter.username}` : "deleted account"}
          {" · "}
          {new Date(report.createdAt).toLocaleString()}
        </Text>

        <View style={styles.actions}>
          {report.status !== "reviewing" ? (
            <StatusButton
              label={report.status === "open" ? "Start review" : "Reopen"}
              icon={report.status === "open" ? "eye" : "rotate-ccw"}
              disabled={updateReport.isPending}
              colors={colors}
              onPress={() => changeStatus(report.id, report.status === "open" ? "reviewing" : "open")}
            />
          ) : (
            <StatusButton
              label="Reopen"
              icon="rotate-ccw"
              disabled={updateReport.isPending}
              colors={colors}
              onPress={() => changeStatus(report.id, "open")}
            />
          )}
          {report.status !== "resolved" ? (
            <StatusButton
              label="Resolve"
              icon="check"
              disabled={updateReport.isPending}
              colors={colors}
              emphasized
              onPress={() => changeStatus(report.id, "resolved")}
            />
          ) : null}
          {report.status !== "dismissed" ? (
            <StatusButton
              label="Dismiss"
              icon="x"
              disabled={updateReport.isPending}
              colors={colors}
              onPress={() => changeStatus(report.id, "dismissed")}
            />
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top + 8 },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.headerButton}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Moderation
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh reports"
          onPress={() => void reports.refetch()}
          disabled={reports.isFetching}
          hitSlop={8}
          style={styles.headerButton}
        >
          {reports.isFetching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={18} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      {access.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : access.isError ? (
        <View style={styles.center}>
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            Couldn’t verify moderator access.
          </Text>
          <Pressable onPress={() => void access.refetch()}>
            <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : !access.data?.isModerator ? (
        <View style={styles.center}>
          <Feather name="lock" size={28} color={colors.mutedForeground} />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            This area is only available to moderators.
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Review reader reports and update their status.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statusFilters}
          >
            {REPORT_STATUSES.map((status) => {
              const selected = status.value === selectedStatus;
              return (
                <Pressable
                  key={status.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setSelectedStatus(status.value)}
                  style={[
                    styles.filter,
                    {
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      {
                        color: selected
                          ? colors.primaryForeground
                          : colors.foreground,
                      },
                    ]}
                  >
                    {status.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {reports.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : reports.isError ? (
            <View style={styles.center}>
              <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
                Couldn’t load reports.
              </Text>
              <Pressable onPress={() => void reports.refetch()}>
                <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
              </Pressable>
            </View>
          ) : reports.data?.length ? (
            <ScrollView contentContainerStyle={styles.reportList}>
              {reports.data.map(renderReport)}
            </ScrollView>
          ) : (
            <View style={styles.center}>
              <Feather name="check-circle" size={30} color={colors.mutedForeground} />
              <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
                No {selectedStatus} reports.
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

function StatusButton({
  label,
  icon,
  colors,
  disabled,
  emphasized = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  colors: ReturnType<typeof useColors>;
  disabled: boolean;
  emphasized?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: emphasized ? colors.primary : "transparent",
          borderColor: emphasized ? colors.primary : colors.border,
          borderRadius: colors.radius,
          opacity: pressed || disabled ? 0.6 : 1,
        },
      ]}
    >
      <Feather
        name={icon}
        size={14}
        color={emphasized ? colors.primaryForeground : colors.foreground}
      />
      <Text
        style={[
          styles.actionText,
          { color: emphasized ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 36, minHeight: 36, justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingTop: 14 },
  statusFilters: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filter: { minHeight: 36, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1 },
  filterText: { fontSize: 12, fontWeight: "600" },
  reportList: { padding: 16, paddingTop: 2, gap: 12 },
  reportCard: { padding: 14, borderWidth: 1, gap: 8 },
  reportTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  labels: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  reason: { fontSize: 14, fontWeight: "700" },
  targetType: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  status: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  targetAuthor: { fontSize: 12, fontWeight: "600" },
  preview: { fontSize: 14, lineHeight: 20 },
  details: { padding: 10, gap: 4 },
  detailsLabel: { fontSize: 11, fontWeight: "700" },
  detailsText: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  actionButton: { minHeight: 36, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1 },
  actionText: { fontSize: 12, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  stateText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "700" },
});
