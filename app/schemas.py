from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator


class OrderBase(BaseModel):
    client: str
    order_number: str
    status: str
    priority: str
    deadline: date
    notes: Optional[str] = None


class OrderCreate(OrderBase):
    user_id: int
    reminder_offsets: Optional[List[int]] = None


class OrderUpdate(BaseModel):
    client: Optional[str] = None
    order_number: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    deadline: Optional[date] = None
    notes: Optional[str] = None
    reminder_offsets: Optional[List[int]] = None


class OrderOut(OrderBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReminderOut(BaseModel):
    id: int
    order_id: int
    user_id: int
    remind_on: date
    sent_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReminderSet(BaseModel):
    reminder_offsets: Optional[List[int]] = None
    reminder_dates: Optional[List[date]] = None


class JournalBase(BaseModel):
    title: str
    entry_date: date
    materials: Optional[str] = None
    tools: Optional[str] = None
    settings: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    order_id: Optional[int] = None


class JournalCreate(JournalBase):
    user_id: int


class JournalUpdate(BaseModel):
    title: Optional[str] = None
    entry_date: Optional[date] = None
    materials: Optional[str] = None
    tools: Optional[str] = None
    settings: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    order_id: Optional[int] = None


class JournalOut(JournalBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("tags", mode="before")
    @classmethod
    def _tags_from_str(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            return [t for t in v.split(",") if t]
        return v


class AttachmentOut(BaseModel):
    id: int
    journal_entry_id: int
    user_id: int
    kind: str
    filename: str
    content_type: Optional[str] = None
    size: int
    stored_path: str
    created_at: datetime

    model_config = {"from_attributes": True}
