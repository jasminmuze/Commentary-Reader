import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSubmitFeedback } from "@workspace/api-client-react";
import type { FeedbackInputType } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

const COPY: Record<
  FeedbackInputType,
  { title: string; placeholder: string; icon: "message-circle" | "alert-circle" }
> = {
  feedback: {
    title: "Send Feedback",
    placeholder: "Tell us what you think — ideas, requests, anything...",
    icon: "message-circle",
  },
  bug: {
    title: "Report a Bug",
    placeholder: "What went wrong? What did you expect to happen?",
    icon: "alert-circle",
  },
};

interface Props {
  visible: boolean;
  type: FeedbackInputType;
  onClose: () => void;
}

// Compose modal for in-app feedback / bug reports, opened from the profile
// screen. Submissions are just stored server-side (no admin view yet).
export function FeedbackModal({ visible, type, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const submitFeedback = useSubmitFeedback();
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  // Fresh state every time the modal opens.
  useEffect(() => {
    if (visible) {
      setText("");
      setSent(false);
      setError(false);
    }
  }, [visible]);

  const copy = COPY[type];
  const canSubmit = text.trim().length > 0 && !submitFeedback.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setError(false);
    submitFeedback.mutate(
      { data: { type, text: text.trim() } },
      {
        onSuccess: () => setSent(true),
        onError: () => setError(true),
      },
    );
  };

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        style={styles.kvWrapper}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: bottomPad + 16,
            },
          ]}
        >
          <View style={styles.headerRow}>
            <Feather name={copy.icon} size={18} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground }]}>{copy.title}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {sent ? (
            <View style={styles.sentBox}>
              <Feather name="check-circle" size={32} color={colors.primary} />
              <Text style={[styles.sentTitle, { color: colors.foreground }]}>
                Thank you!
              </Text>
              <Text style={[styles.sentSub, { color: colors.mutedForeground }]}>
                {type === "bug"
                  ? "Your bug report has been received."
                  : "Your feedback has been received."}
              </Text>
              <Pressable
                onPress={onClose}
                style={[
                  styles.doneBtn,
                  { backgroundColor: colors.primary, borderRadius: colors.radius },
                ]}
              >
                <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>
                  Done
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
                placeholder={copy.placeholder}
                placeholderTextColor={colors.mutedForeground}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={2000}
                autoFocus
                textAlignVertical="top"
              />
              {error ? (
                <Text style={[styles.errorText, { color: colors.destructive }]}>
                  Could not send right now. Please try again.
                </Text>
              ) : null}
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.submitBtn,
                  {
                    backgroundColor: canSubmit ? colors.primary : colors.muted,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {submitFeedback.isPending ? (
                  <ActivityIndicator size={16} color={colors.primaryForeground} />
                ) : (
                  <Text
                    style={[
                      styles.submitBtnText,
                      { color: canSubmit ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    Submit
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  kvWrapper: {
    flex: 1,
    justifyContent: "flex-end",
    pointerEvents: "box-none",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    flex: 1,
  },
  closeBtn: {
    padding: 2,
  },
  input: {
    minHeight: 120,
    maxHeight: 220,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    lineHeight: 20,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    fontWeight: "600",
  },
  submitBtn: {
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  sentBox: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 20,
  },
  sentTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: 4,
  },
  sentSub: {
    fontSize: 13,
    textAlign: "center",
  },
  doneBtn: {
    marginTop: 12,
    height: 44,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
