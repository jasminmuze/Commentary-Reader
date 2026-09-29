import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateRoom,
  getGetBookRoomsQueryKey,
  getGetMyRoomsQueryKey,
  getGetTrendingRoomsQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

export default function CreateRoomScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ bookId?: string; bookTitle?: string }>();
  const bookId = Number(params.bookId);
  const bookTitle = typeof params.bookTitle === "string" ? params.bookTitle : "";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  const createRoom = useCreateRoom();

  const handleCreate = () => {
    if (!Number.isFinite(bookId) || bookId <= 0 || !name.trim()) return;
    createRoom.mutate(
      {
        data: {
          canonicalBookId: bookId,
          name: name.trim(),
          description: description.trim() || undefined,
          isPublic,
        },
      },
      {
        onSuccess: (room) => {
          queryClient.invalidateQueries({ queryKey: getGetBookRoomsQueryKey(bookId) });
          queryClient.invalidateQueries({ queryKey: getGetMyRoomsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTrendingRoomsQueryKey() });
          router.replace(`/room/${room.id}`);
        },
        onError: () => {
          Alert.alert("Couldn't create the room", "Please try again in a moment.");
        },
      },
    );
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>New reading room</Text>
      </View>

      <View style={styles.form}>
        {bookTitle ? (
          <View
            style={[
              styles.bookBadge,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <Feather name="book" size={14} color={colors.primary} />
            <Text style={[styles.bookBadgeText, { color: colors.foreground }]} numberOfLines={1}>
              {bookTitle}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>ROOM NAME</Text>
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
          placeholder="e.g. Sunday morning readers"
          placeholderTextColor={colors.mutedForeground}
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoFocus
        />

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>
          DESCRIPTION (OPTIONAL)
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.multiline,
            {
              backgroundColor: colors.card,
              color: colors.foreground,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
          placeholder="What is this room about?"
          placeholderTextColor={colors.mutedForeground}
          value={description}
          onChangeText={setDescription}
          maxLength={500}
          multiline
        />

        <View
          style={[
            styles.switchRow,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.switchLabel, { color: colors.foreground }]}>Public room</Text>
            <Text style={[styles.switchDesc, { color: colors.mutedForeground }]}>
              {isPublic
                ? "Anyone can find and join this room"
                : "Only invited friends can see and join"}
            </Text>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        <Pressable
          onPress={handleCreate}
          disabled={!name.trim() || createRoom.isPending}
          style={({ pressed }) => [
            styles.createBtn,
            {
              backgroundColor: name.trim() ? colors.primary : colors.muted,
              borderRadius: colors.radius,
              opacity: pressed || createRoom.isPending ? 0.8 : 1,
            },
          ]}
        >
          <Feather
            name="users"
            size={16}
            color={name.trim() ? colors.primaryForeground : colors.mutedForeground}
          />
          <Text
            style={[
              styles.createBtnText,
              { color: name.trim() ? colors.primaryForeground : colors.mutedForeground },
            ]}
          >
            Create room
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 2 },
  title: { fontSize: 20, fontWeight: "700" },
  form: { paddingHorizontal: 20, paddingTop: 20 },
  bookBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  bookBadgeText: { fontSize: 13, fontWeight: "600", flex: 1 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    marginTop: 22,
  },
  switchLabel: { fontSize: 14, fontWeight: "600" },
  switchDesc: { fontSize: 12, marginTop: 2 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    marginTop: 26,
  },
  createBtnText: { fontSize: 15, fontWeight: "700" },
});
