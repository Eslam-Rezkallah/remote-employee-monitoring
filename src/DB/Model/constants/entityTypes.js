/**
 * Canonical entity types across the platform.
 * Add new types here and nowhere else.
 */
export const EntityType = Object.freeze({
  Task: "Task",
  Comment: "Comment",
  Project: "Project",
  Team: "Team",
  Sprint: "Sprint",
  Space: "Space",
  Organization: "Organization",
});

// Subset allowed in Notification.entityType
export const NotificationEntityTypes = Object.freeze({
  Task: EntityType.Task,
  Comment: EntityType.Comment,
  Project: EntityType.Project,
  Team: EntityType.Team,
  Sprint: EntityType.Sprint,
});

// Subset allowed in RecentActivity.entityType
export const ActivityEntityTypes = Object.freeze({
  Task: EntityType.Task,
  Space: EntityType.Space,
  Sprint: EntityType.Sprint,
  Comment: EntityType.Comment,
  Organization: EntityType.Organization,
});
