"""Initial schema — tenants, users, vehicles, jobs, telemetry_events, audit_logs.

Revision ID: 001_initial_schema
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Extensions ────────────────────────────────────────────────────────────
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")

    # Create app_user role first (so it's available for RLS policies)
    op.execute("CREATE ROLE app_user LOGIN PASSWORD 'changeme_in_production'")

    # ── tenants ───────────────────────────────────────────────────────────────
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("subdomain", sa.String(63), nullable=False, unique=True),
        sa.Column("plan", sa.String(50), nullable=False, server_default="free"),
        sa.Column("branding", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_tenants_subdomain", "tenants", ["subdomain"])

    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )
    op.create_index("idx_users_tenant_id", "users", ["tenant_id"])
    op.create_index("idx_users_email", "users", ["email"])

    # ── vehicles ──────────────────────────────────────────────────────────────
    op.create_table(
        "vehicles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("registration", sa.String(20), nullable=False),
        sa.Column("make", sa.String(100), nullable=True),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("year", sa.SmallInteger, nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="idle"),
        sa.Column("assigned_driver_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("tenant_id", "registration", name="uq_vehicles_tenant_reg"),
    )
    op.create_index("idx_vehicles_tenant_id", "vehicles", ["tenant_id"])
    op.create_index("idx_vehicles_status", "vehicles", ["status"])

    # ── jobs ──────────────────────────────────────────────────────────────────
    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vehicle_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vehicles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("driver_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("priority", sa.SmallInteger, nullable=False, server_default="3"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pickup_address", postgresql.JSONB, nullable=True),
        sa.Column("delivery_address", postgresql.JSONB, nullable=True),
        sa.Column("version", sa.BigInteger, nullable=False, server_default="1"),
        sa.Column("last_modified_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("client_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("server_updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_jobs_tenant_id", "jobs", ["tenant_id"])
    op.create_index("idx_jobs_driver_id", "jobs", ["driver_id"])
    op.create_index("idx_jobs_vehicle_id", "jobs", ["vehicle_id"])
    op.create_index("idx_jobs_status", "jobs", ["status"])
    op.create_index("idx_jobs_scheduled_at", "jobs", ["scheduled_at"])

    # ── telemetry_events (TimescaleDB hypertable) ─────────────────────────────
    op.create_table(
        "telemetry_events",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vehicle_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("speed", sa.Float, nullable=True),
        sa.Column("heading", sa.Float, nullable=True),
        sa.Column("battery_level", sa.Float, nullable=True),
        sa.Column("engine_on", sa.Boolean, nullable=True),
        sa.Column("raw_payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("time", "vehicle_id"),
    )
    op.create_index("idx_telemetry_tenant_vehicle", "telemetry_events", ["tenant_id", "vehicle_id", "time"])
    # Convert to TimescaleDB hypertable — partitioned weekly by time
    op.execute("SELECT create_hypertable('telemetry_events', 'time', chunk_time_interval => INTERVAL '1 week', if_not_exists => TRUE)")
    
    # RLS is not supported on TimescaleDB hypertables with compression enabled, so it is omitted for telemetry_events.

    op.execute("""
        ALTER TABLE telemetry_events SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'vehicle_id',
            timescaledb.compress_orderby   = 'time DESC'
        )
    """)
    op.execute("SELECT add_compression_policy('telemetry_events', INTERVAL '7 days')")

    # ── audit_logs ────────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("old_value", postgresql.JSONB, nullable=True),
        sa.Column("new_value", postgresql.JSONB, nullable=True),
        sa.Column("ip_address", postgresql.INET, nullable=True),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_audit_tenant_id", "audit_logs", ["tenant_id"])
    op.create_index("idx_audit_user_id", "audit_logs", ["user_id"])
    op.create_index("idx_audit_created_at", "audit_logs", ["created_at"])
    op.create_index("idx_audit_resource", "audit_logs", ["resource_type", "resource_id"])

    # ── RLS Setup ─────────────────────────────────────────────────────────────
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON users, vehicles, jobs, telemetry_events, audit_logs TO app_user")
    op.execute("GRANT SELECT ON tenants TO app_user")

    for table in ["users", "vehicles", "jobs", "audit_logs"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            CREATE POLICY tenant_isolation_{table} ON {table}
            FOR ALL TO app_user
            USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
        """)


def downgrade() -> None:
    for table in ["users", "vehicles", "jobs", "audit_logs"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_telemetry_events ON telemetry_events")

    op.drop_table("audit_logs")
    op.drop_table("telemetry_events")
    op.drop_table("jobs")
    op.drop_table("vehicles")
    op.drop_table("users")
    op.drop_table("tenants")
    op.execute("DROP ROLE IF EXISTS app_user")
