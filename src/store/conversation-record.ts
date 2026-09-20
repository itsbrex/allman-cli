import type { ConversationData } from "../linkedin/api/endpoints/conversations.js";
import { extractBareConvId, profileUrnId } from "../utils/urn.js";
import type { ConversationRecord } from "./types.js";

export function conversationRecordFrom(
  conv: ConversationData,
  myProfileUrn: string,
  previous?: ConversationRecord | null,
  slug?: string
): ConversationRecord {
  if (conv.isGroup) throw new Error("Group conversations are not supported by send");
  const other = conv.participants.find((p) => p.entityUrn !== myProfileUrn);
  if (!other) throw new Error("Conversation has no identifiable recipient");
  const name = other.name ?? previous?.name ?? "Unknown";
  const [firstName = "", ...rest] = name.split(" ");
  const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());
  return {
    convId: extractBareConvId(conv.backendUrn || conv.urn),
    profileId: profileUrnId(other.entityUrn),
    slug: slug ?? previous?.slug ?? null,
    convUrn: conv.urn,
    backendUrn: conv.backendUrn || null,
    profileUrn: other.entityUrn,
    memberUrn: previous?.memberUrn ?? null,
    firstName,
    lastName: rest.join(" "),
    name,
    headline: other.headline,
    profileUrl: other.profileUrl,
    profilePictures: other.profilePictures ?? [],
    distance: other.distance,
    pronoun: other.pronoun,
    memberBadgeType: other.memberBadgeType,
    isPremium: other.isPremium,
    isVerified: other.isVerified,
    unreadCount: conv.unreadCount,
    read: conv.read,
    lastReadAt: iso(conv.lastReadAt),
    lastActivityAt: iso(conv.lastActivityAt),
    createdAt: iso(conv.createdAt),
    notificationStatus: conv.notificationStatus,
    categories: conv.categories,
    conversationUrl: conv.conversationUrl,
    disabledFeatures: conv.disabledFeatures,
    localAcknowledgedAt: previous?.localAcknowledgedAt,
    syncState: previous?.syncState ?? {
      oldestMessageAt: null,
      newestMessageAt: null,
      lastSyncAt: null,
      totalSynced: 0,
      fullyBackfilled: false,
    },
    fetchedAt: new Date().toISOString(),
  };
}
