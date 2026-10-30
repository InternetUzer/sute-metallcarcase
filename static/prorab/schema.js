// Сгенерировано web/tools/schema.py из Model.kt — не править вручную.
window.PRORAB_SCHEMA = {
 "projects": {
  "class": "Project",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "address": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "customer": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "supervisor": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "contractor": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "startDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "deadline": {
    "type": "int",
    "null": true,
    "def": null
   },
   "lat": {
    "type": "real",
    "null": true,
    "def": null
   },
   "lon": {
    "type": "real",
    "null": true,
    "def": null
   },
   "place": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "project_fields": {
  "class": "ProjectField",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "value": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "position": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "contractors": {
  "class": "Contractor",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "specialty": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "phone": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "email": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "work_types": {
  "class": "WorkType",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "units": {
  "class": "MeasureUnit",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "journal": {
  "class": "JournalEntry",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "workTypeId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "startDate": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "endDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "volume": {
    "type": "real",
    "null": true,
    "def": null
   },
   "unitId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "boq_items": {
  "class": "BoqItem",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "workTypeId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "unitId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "planQty": {
    "type": "real",
    "null": true,
    "def": null
   },
   "priceCents": {
    "type": "int",
    "null": true,
    "def": null
   },
   "position": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "finishedDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "startDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "dueDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "extraDate": {
    "type": "int",
    "null": true,
    "def": null
   }
  }
 },
 "tasks": {
  "class": "PlanTask",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "itemId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "title": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "planQty": {
    "type": "real",
    "null": true,
    "def": null
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "done": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "volumes": {
  "class": "VolumeEntry",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "workTypeId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "quantity": {
    "type": "real",
    "null": false,
    "def": 0.0
   },
   "unitId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "itemId": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "attachments": {
  "class": "Attachment",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "ownerId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "kind": {
    "type": "text",
    "null": false,
    "def": "photo"
   },
   "file": {
    "type": "text",
    "null": false,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "drawings": {
  "class": "Drawing",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "kind": {
    "type": "text",
    "null": false,
    "def": "dxf"
   },
   "file": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "pages": {
    "type": "int",
    "null": false,
    "def": 1
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "drawing_views": {
  "class": "PlanView",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "drawingId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "position": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "page": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "hiddenLayers": {
    "type": "text",
    "null": true,
    "def": null
   },
   "cx": {
    "type": "real",
    "null": true,
    "def": null
   },
   "cy": {
    "type": "real",
    "null": true,
    "def": null
   },
   "span": {
    "type": "real",
    "null": true,
    "def": null
   },
   "rotation": {
    "type": "real",
    "null": false,
    "def": 0.0
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "drawing_notes": {
  "class": "DrawingNote",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "drawingId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "page": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "x": {
    "type": "real",
    "null": false,
    "def": 0.0
   },
   "y": {
    "type": "real",
    "null": false,
    "def": 0.0
   },
   "number": {
    "type": "int",
    "null": false,
    "def": 1
   },
   "text": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "status": {
    "type": "text",
    "null": false,
    "def": "NOTE"
   },
   "viewId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "doneDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "dueDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "acceptanceId": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "drawing_shapes": {
  "class": "DrawingShape",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "drawingId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "page": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "kind": {
    "type": "text",
    "null": false,
    "def": "line"
   },
   "points": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "text": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "color": {
    "type": "text",
    "null": false,
    "def": "#FF3B30"
   },
   "width": {
    "type": "real",
    "null": false,
    "def": 2.0
   },
   "size": {
    "type": "real",
    "null": true,
    "def": null
   },
   "value": {
    "type": "real",
    "null": true,
    "def": null
   },
   "viewId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "remarks": {
  "class": "Remark",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "number": {
    "type": "int",
    "null": false,
    "def": 1
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "text": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "place": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "status": {
    "type": "text",
    "null": false,
    "def": "OPEN"
   },
   "doneDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "doneNote": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "dueDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "acceptanceId": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "day_weather": {
  "class": "DayWeather",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": null
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "date": {
    "type": "int",
    "null": false,
    "def": null
   },
   "tMin": {
    "type": "real",
    "null": true,
    "def": null
   },
   "tMax": {
    "type": "real",
    "null": true,
    "def": null
   },
   "precip": {
    "type": "real",
    "null": true,
    "def": null
   },
   "wind": {
    "type": "real",
    "null": true,
    "def": null
   },
   "code": {
    "type": "int",
    "null": true,
    "def": null
   },
   "forecast": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "lat": {
    "type": "real",
    "null": true,
    "def": null
   },
   "lon": {
    "type": "real",
    "null": true,
    "def": null
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "finance": {
  "class": "FinanceEntry",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "type": {
    "type": "text",
    "null": false,
    "def": "EXPENSE"
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "title": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "amountCents": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "workTypeId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "photo": {
    "type": "text",
    "null": true,
    "def": null
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "category": {
    "type": "text",
    "null": true,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "extra_approvals": {
  "class": "ExtraApproval",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": null
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "itemId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "designerDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "supervisorDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "contractorDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "customerDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "description": {
    "type": "text",
    "null": true,
    "def": null
   },
   "noteId": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "acceptances": {
  "class": "Acceptance",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "itemId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "readyDate": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "planDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "result": {
    "type": "text",
    "null": false,
    "def": "PENDING"
   },
   "resultDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "acceptedBy": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "entryId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "qty": {
    "type": "real",
    "null": true,
    "def": null
   },
   "workName": {
    "type": "text",
    "null": true,
    "def": null
   },
   "unitName": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "sync_state": {
  "class": "SyncState",
  "pk": "projectId",
  "cols": {
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "token": {
    "type": "text",
    "null": false,
    "def": null
   }
  }
 },
 "project_nodes": {
  "class": "ProjectNode",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "parentId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "kind": {
    "type": "text",
    "null": false,
    "def": null
   },
   "label": {
    "type": "text",
    "null": false,
    "def": null
   },
   "location": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "position": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "work_bindings": {
  "class": "WorkBinding",
  "pk": "itemId",
  "cols": {
   "itemId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "nodeId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "templateKey": {
    "type": "text",
    "null": false,
    "def": null
   },
   "templateRevision": {
    "type": "int",
    "null": false,
    "def": null
   },
   "templateSnapshotJson": {
    "type": "text",
    "null": false,
    "def": null
   },
   "segmentKey": {
    "type": "text",
    "null": false,
    "def": "whole"
   },
   "alternativeGroup": {
    "type": "text",
    "null": true,
    "def": null
   },
   "variantMode": {
    "type": "text",
    "null": true,
    "def": null
   },
   "id": {
    "type": "text",
    "null": false,
    "def": null
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "work_calcs": {
  "class": "WorkCalc",
  "pk": "itemId",
  "cols": {
   "itemId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "calcKey": {
    "type": "text",
    "null": false,
    "def": null
   },
   "paramsJson": {
    "type": "text",
    "null": false,
    "def": null
   },
   "appliedHash": {
    "type": "text",
    "null": true,
    "def": null
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   }
  }
 },
 "calc_records": {
  "class": "CalcRecord",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "workId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "expression": {
    "type": "text",
    "null": false,
    "def": null
   },
   "result": {
    "type": "text",
    "null": false,
    "def": null
   },
   "unit": {
    "type": "text",
    "null": false,
    "def": null
   },
   "label": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "appliedMode": {
    "type": "text",
    "null": true,
    "def": null
   },
   "appliedCount": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "appliedAt": {
    "type": "int",
    "null": true,
    "def": null
   }
  }
 },
 "calc_inputs": {
  "class": "CalcInput",
  "pk": "workId",
  "cols": {
   "workId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "expression": {
    "type": "text",
    "null": false,
    "def": null
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   }
  }
 },
 "rental_equipment": {
  "class": "RentalEquipment",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "kind": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "plate": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "supplier": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "contact": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "phone": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "termsJson": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "archived": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "rental_orders": {
  "class": "RentalOrder",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "equipmentId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "title": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "termsJson": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "startDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "endDate": {
    "type": "int",
    "null": true,
    "def": null
   },
   "closed": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "archived": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "rental_calls": {
  "class": "RentalCall",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "orderId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "timeMin": {
    "type": "int",
    "null": true,
    "def": null
   },
   "itemId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "place": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "plannedMinutes": {
    "type": "int",
    "null": true,
    "def": null
   },
   "contact": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "comment": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "remindAt": {
    "type": "int",
    "null": true,
    "def": null
   },
   "status": {
    "type": "text",
    "null": false,
    "def": "PLANNED"
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "rental_work": {
  "class": "RentalWork",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "orderId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "callId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "intervalsJson": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "manualMinutes": {
    "type": "int",
    "null": true,
    "def": null
   },
   "breakMinutes": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "idleMinutes": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "idleReason": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "idlePaid": {
    "type": "bool",
    "null": false,
    "def": 1
   },
   "itemId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "place": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "comment": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "amountCents": {
    "type": "int",
    "null": true,
    "def": null
   },
   "entryId": {
    "type": "text",
    "null": true,
    "def": null
   }
  }
 },
 "rental_extras": {
  "class": "RentalExtra",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "orderId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "date": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "today"
    }
   },
   "kind": {
    "type": "text",
    "null": false,
    "def": "DELIVERY"
   },
   "amountCents": {
    "type": "int",
    "null": false,
    "def": 0
   },
   "comment": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "createdAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "rental_payment_links": {
  "class": "RentalPaymentLink",
  "pk": "financeId",
  "cols": {
   "financeId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "orderId": {
    "type": "text",
    "null": false,
    "def": null
   }
  }
 },
 "crews": {
  "class": "Crew",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "name": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "contractorId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "note": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "archived": {
    "type": "bool",
    "null": false,
    "def": 0
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "crew_days": {
  "class": "CrewDay",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": null
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "crewId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "date": {
    "type": "int",
    "null": false,
    "def": null
   },
   "people": {
    "type": "int",
    "null": false,
    "def": null
   },
   "comment": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "updatedAt": {
    "type": "int",
    "null": false,
    "def": {
     "fn": "now"
    }
   },
   "deleted": {
    "type": "bool",
    "null": false,
    "def": 0
   }
  }
 },
 "crew_places": {
  "class": "CrewPlace",
  "pk": "id",
  "cols": {
   "id": {
    "type": "text",
    "null": false,
    "def": {
     "fn": "id"
    }
   },
   "projectId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "crewDayId": {
    "type": "text",
    "null": false,
    "def": null
   },
   "itemId": {
    "type": "text",
    "null": true,
    "def": null
   },
   "place": {
    "type": "text",
    "null": false,
    "def": ""
   },
   "people": {
    "type": "int",
    "null": true,
    "def": null
   }
  }
 }
};
