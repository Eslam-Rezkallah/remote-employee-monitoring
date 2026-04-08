import pandas as pd
import streamlit as st
from pathlib import Path

st.set_page_config(page_title="Department Skill & Task Finder", page_icon="🔎", layout="wide")

BASE_DIR = Path(__file__).resolve().parent
TASKS_FILE = BASE_DIR / "department_employee_tasks.csv"
SKILLS_FILE = BASE_DIR / "department_employee_skills.csv"


@st.cache_data
def load_data(tasks_file: Path, skills_file: Path):
    tasks_df = pd.read_csv(tasks_file)
    skills_df = pd.read_csv(skills_file)

    # clean column names
    tasks_df.columns = tasks_df.columns.str.strip()
    skills_df.columns = skills_df.columns.str.strip()

    # clean text values
    for col in ["Department", "employee_name", "task"]:
        if col in tasks_df.columns:
            tasks_df[col] = tasks_df[col].astype(str).str.strip()

    for col in ["Department", "employee_name", "skill"]:
        if col in skills_df.columns:
            skills_df[col] = skills_df[col].astype(str).str.strip()

    # remove empty rows
    tasks_df = tasks_df.dropna(subset=["Department", "employee_name", "task"]).drop_duplicates()
    skills_df = skills_df.dropna(subset=["Department", "employee_name", "skill"]).drop_duplicates()

    tasks_df = tasks_df[
        (tasks_df["Department"] != "") &
        (tasks_df["employee_name"] != "") &
        (tasks_df["task"] != "")
    ]

    skills_df = skills_df[
        (skills_df["Department"] != "") &
        (skills_df["employee_name"] != "") &
        (skills_df["skill"] != "")
    ]

    return tasks_df, skills_df


def build_employee_profile(tasks_df: pd.DataFrame, skills_df: pd.DataFrame) -> pd.DataFrame:
    employee_tasks = (
        tasks_df.groupby(["Department", "employee_name"])["task"]
        .apply(lambda x: sorted(set(x)))
        .reset_index()
    )

    employee_skills = (
        skills_df.groupby(["Department", "employee_name"])["skill"]
        .apply(lambda x: sorted(set(x)))
        .reset_index()
    )

    profile = pd.merge(
        employee_tasks,
        employee_skills,
        on=["Department", "employee_name"],
        how="outer"
    )

    profile["task"] = profile["task"].apply(lambda x: x if isinstance(x, list) else [])
    profile["skill"] = profile["skill"].apply(lambda x: x if isinstance(x, list) else [])

    return profile.sort_values(["Department", "employee_name"]).reset_index(drop=True)


def exact_skill_search(skills_df: pd.DataFrame, selected_skill: str) -> pd.DataFrame:
    result = skills_df[
        skills_df["skill"].str.lower() == selected_skill.lower()
    ][["Department", "employee_name", "skill"]]
    return result.drop_duplicates().sort_values(["employee_name", "skill"])


def exact_task_search(tasks_df: pd.DataFrame, selected_task: str) -> pd.DataFrame:
    result = tasks_df[
        tasks_df["task"].str.lower() == selected_task.lower()
    ][["Department", "employee_name", "task"]]
    return result.drop_duplicates().sort_values(["employee_name", "task"])


def keyword_skill_search(skills_df: pd.DataFrame, keyword: str) -> pd.DataFrame:
    keyword = keyword.strip()
    if not keyword:
        return pd.DataFrame(columns=["Department", "employee_name", "skill"])

    result = skills_df[
        skills_df["skill"].str.contains(keyword, case=False, na=False)
    ][["Department", "employee_name", "skill"]]

    return result.drop_duplicates().sort_values(["employee_name", "skill"])


def keyword_task_search(tasks_df: pd.DataFrame, keyword: str) -> pd.DataFrame:
    keyword = keyword.strip()
    if not keyword:
        return pd.DataFrame(columns=["Department", "employee_name", "task"])

    result = tasks_df[
        tasks_df["task"].str.contains(keyword, case=False, na=False)
    ][["Department", "employee_name", "task"]]

    return result.drop_duplicates().sort_values(["employee_name", "task"])


def employees_with_both(tasks_df: pd.DataFrame, skills_df: pd.DataFrame, selected_skill: str, selected_task: str) -> pd.DataFrame:
    skill_people = set(
        skills_df[skills_df["skill"].str.lower() == selected_skill.lower()]["employee_name"]
    )
    task_people = set(
        tasks_df[tasks_df["task"].str.lower() == selected_task.lower()]["employee_name"]
    )
    both = sorted(skill_people.intersection(task_people))
    return pd.DataFrame({"employee_name": both})


def main():
    st.title("🔎 Department Employee Skill & Task Finder")
    st.caption("Select a department first, then search employees by skill or task inside that department.")

    if not Path(TASKS_FILE).exists() or not Path(SKILLS_FILE).exists():
        st.error(
            "Missing input files. Put these files in the same folder as the app: "
            "department_employee_tasks.csv and department_employee_skills.csv"
        )
        st.stop()

    tasks_df, skills_df = load_data(TASKS_FILE, SKILLS_FILE)
    profile_df = build_employee_profile(tasks_df, skills_df)

    all_departments = sorted(
        set(tasks_df["Department"].dropna().unique()).union(
            set(skills_df["Department"].dropna().unique())
        )
    )

    selected_department = st.selectbox("Select Department", all_departments)

    # filter by selected department
    dept_tasks_df = tasks_df[tasks_df["Department"] == selected_department].copy()
    dept_skills_df = skills_df[skills_df["Department"] == selected_department].copy()
    dept_profile_df = profile_df[profile_df["Department"] == selected_department].copy()

    st.subheader(f"Department Overview: {selected_department}")

    col1, col2 = st.columns(2)

    with col1:
        st.markdown("**Skills in this department**")
        st.dataframe(
            pd.DataFrame(sorted(dept_skills_df["skill"].dropna().unique()), columns=["skill"]),
            use_container_width=True
        )

    with col2:
        st.markdown("**Tasks in this department**")
        st.dataframe(
            pd.DataFrame(sorted(dept_tasks_df["task"].dropna().unique()), columns=["task"]),
            use_container_width=True
        )

    tab1, tab2, tab3, tab4 = st.tabs([
        "Search by skill",
        "Search by task",
        "Skill + task",
        "Employee profiles",
    ])

    all_skills = sorted(dept_skills_df["skill"].dropna().unique().tolist())
    all_tasks = sorted(dept_tasks_df["task"].dropna().unique().tolist())

    with tab1:
        st.subheader("Find employees by skill")
        search_mode_skill = st.radio(
            "Search mode",
            ["Exact match", "Keyword contains"],
            horizontal=True,
            key="skill_mode"
        )

        if search_mode_skill == "Exact match":
            selected_skill = st.selectbox("Choose a skill", all_skills)
            result = exact_skill_search(dept_skills_df, selected_skill)
        else:
            keyword = st.text_input("Enter part of the skill name", placeholder="e.g. python, aws, react")
            result = keyword_skill_search(dept_skills_df, keyword)

        st.write(f"Matches: {len(result)}")
        st.dataframe(result, use_container_width=True)

    with tab2:
        st.subheader("Find employees by task")
        search_mode_task = st.radio(
            "Search mode",
            ["Exact match", "Keyword contains"],
            horizontal=True,
            key="task_mode"
        )

        if search_mode_task == "Exact match":
            selected_task = st.selectbox("Choose a task", all_tasks)
            result = exact_task_search(dept_tasks_df, selected_task)
        else:
            keyword = st.text_input("Enter part of the task name", placeholder="e.g. security, dashboard, migration")
            result = keyword_task_search(dept_tasks_df, keyword)

        st.write(f"Matches: {len(result)}")
        st.dataframe(result, use_container_width=True)

    with tab3:
        st.subheader("Find employees who match both a skill and a task")
        selected_skill_both = st.selectbox("Choose a skill", all_skills, key="both_skill")
        selected_task_both = st.selectbox("Choose a task", all_tasks, key="both_task")
        both_result = employees_with_both(dept_tasks_df, dept_skills_df, selected_skill_both, selected_task_both)

        if not both_result.empty:
            both_result["Department"] = selected_department
            both_result = both_result[["Department", "employee_name"]]

        st.write(f"Matches: {len(both_result)}")
        st.dataframe(both_result, use_container_width=True)

    with tab4:
        st.subheader("Browse employee profiles in this department")

        employee_list = sorted(dept_profile_df["employee_name"].dropna().unique().tolist())

        if employee_list:
            selected_employee = st.selectbox("Choose an employee", employee_list)
            row = dept_profile_df[dept_profile_df["employee_name"] == selected_employee].iloc[0]

            col1, col2 = st.columns(2)

            with col1:
                st.markdown("**Skills**")
                if row["skill"]:
                    for item in row["skill"]:
                        st.write(f"- {item}")
                else:
                    st.write("No skills found.")

            with col2:
                st.markdown("**Tasks**")
                if row["task"]:
                    for item in row["task"]:
                        st.write(f"- {item}")
                else:
                    st.write("No tasks found.")

            st.markdown("---")
            st.dataframe(dept_profile_df, use_container_width=True)
        else:
            st.info("No employees found in this department.")


if __name__ == "__main__":
    main()
