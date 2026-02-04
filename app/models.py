from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    Date,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship
from .db import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    user_id = Column(BigInteger, index=True, nullable=False)
    client = Column(String(200), nullable=False)
    order_number = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False)
    priority = Column(String(16), nullable=False)
    deadline = Column(Date, nullable=False)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    reminders = relationship("OrderReminder", back_populates="order", cascade="all, delete-orphan")
    journal_entries = relationship("JournalEntry", back_populates="order")

    __table_args__ = (
        Index("ix_orders_user_order_number", "user_id", "order_number", unique=False),
    )


class OrderReminder(Base):
    __tablename__ = "order_reminders"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(BigInteger, index=True, nullable=False)
    remind_on = Column(Date, nullable=False)
    sent_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="reminders")

    __table_args__ = (
        Index("ix_order_reminders_user_remind_on", "user_id", "remind_on"),
    )


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True)
    user_id = Column(BigInteger, index=True, nullable=False)
    title = Column(String(200), nullable=False)
    entry_date = Column(Date, nullable=False)
    materials = Column(Text)
    tools = Column(Text)
    settings = Column(Text)
    notes = Column(Text)
    tags = Column(Text)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="SET NULL"))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    order = relationship("Order", back_populates="journal_entries")
    attachments = relationship("Attachment", back_populates="journal_entry", cascade="all, delete-orphan")


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(BigInteger, index=True, nullable=False)
    kind = Column(String(16), nullable=False)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(100))
    size = Column(Integer, nullable=False)
    stored_path = Column(String(300), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    journal_entry = relationship("JournalEntry", back_populates="attachments")
