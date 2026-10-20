-- Cover the existing composite membership foreign key identified by the advisor.
create index if not exists planzo_invites_membership_idx on planzo_private.trip_invites(trip_id,created_by);
