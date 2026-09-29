import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type UserObjectUploadKind = "epub" | "avatar";

// Server-issued upload paths are ownership proofs. A client-provided path by
// itself is never sufficient to assign or delete an object.
export const userObjectUploadsTable = pgTable(
  "user_object_uploads",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    kind: text("kind").notNull().$type<UserObjectUploadKind>(),
    objectPath: text("object_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("user_object_uploads_path_unique").on(table.objectPath)],
);

export type UserObjectUpload = typeof userObjectUploadsTable.$inferSelect;
export type InsertUserObjectUpload = typeof userObjectUploadsTable.$inferInsert;