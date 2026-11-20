# Department display labels —local2026-10-25
Source development/source/work/hathir-department-labels-20261025/app
Not published; currentproduction161.
Shared departmentTitle formatter removes leading Arabic قسم and surrounding whitespace in labels; existing rawpersisted names/IDs/data untouched. Dropdown edit field uses same clean label. Duplicate-name key first removes Arabic diacritics then optional leading قسم, preventing visually identical names with/without prefix. No stage/subject/student/attendance/database changes.10existingdepartment management cases passed after normalization-order fix; label assertions passed for defaults/newbranches. Previous161source retained unchanged.

Published162; see review-20261025-release162-status.md.
